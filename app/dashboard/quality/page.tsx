'use client';

import { useState, useEffect } from 'react';
import { Shield, RefreshCw, CheckCircle2, XCircle, AlertTriangle, Phone, TrendingUp, TrendingDown } from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from 'sonner'

interface Number {
  _id: string;
  number: number;
  qualityScore: number;
  suspended: boolean;
  suspensionReason: string;
  consecutiveFailures: number;
  failureCount: number;
  successCount: number;
  active: boolean;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  suspendedAt?: string;
  smsReceivedInWindow?: number;
}

interface QualityResponse {
  success: boolean;
  data?: Number[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
  error?: string;
}

export default function QualityDashboard() {
  const [numbers, setNumbers] = useState<Number[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<'all' | 'suspended' | 'warning' | 'active'>('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedNumbers, setSelectedNumbers] = useState<Set<number>>(new Set());
  const [actionLoading, setActionLoading] = useState(false);

  const fetchNumbers = async () => {
    try {
      setRefreshing(true);
      const response = await fetch(`/api/numbers/quality?filter=${filter}&page=${page}&limit=50`);
      const data: QualityResponse = await response.json();

      if (data.success && data.data) {
        setNumbers(data.data);
        setTotalPages(data.pagination?.pages || 1);
      } else {
        toast.error(data.error || 'Failed to fetch numbers');
      }
    } catch (error) {
      toast.error('Error fetching numbers');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchNumbers();
  }, [filter, page]);

  const handleSelectAll = () => {
    if (selectedNumbers.size === numbers.length) {
      setSelectedNumbers(new Set());
    } else {
      setSelectedNumbers(new Set(numbers.map(n => n.number)));
    }
  };

  const handleSelectNumber = (number: number) => {
    const newSelected = new Set(selectedNumbers);
    if (newSelected.has(number)) {
      newSelected.delete(number);
    } else {
      newSelected.add(number);
    }
    setSelectedNumbers(newSelected);
  };

  const handleBulkAction = async (action: 'suspend' | 'recover' | 'reset') => {
    if (selectedNumbers.size === 0) {
      toast.error('Please select at least one number');
      return;
    }

    setActionLoading(true);
    try {
      const response = await fetch('/api/numbers/quality', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          numbers: Array.from(selectedNumbers),
          reason: 'manual'
        })
      });

      const data = await response.json();
      if (data.success) {
        toast.success(data.message);
        setSelectedNumbers(new Set());
        fetchNumbers();
      } else {
        toast.error(data.error || 'Action failed');
      }
    } catch (error) {
      toast.error('Error performing action');
    } finally {
      setActionLoading(false);
    }
  };

  const getQualityBadge = (score: number) => {
    if (score >= 80) return <Badge className="bg-green-100 text-green-800 hover:bg-green-200">{score}</Badge>;
    if (score >= 50) return <Badge variant="secondary">{score}</Badge>;
    if (score >= 30) return <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-200">{score}</Badge>;
    return <Badge variant="destructive">{score}</Badge>;
  };

  const getSuspensionReasonBadge = (reason: string) => {
    const reasonLabels: Record<string, string> = {
      'none': 'None',
      'low_quality': 'Low Quality',
      'manual': 'Manual',
      'high_failure_rate': 'High Failure',
      'no_recharge': 'No Recharge',
      'low_sms': 'Low SMS'
    };
    return reasonLabels[reason] || reason;
  };

  // Calculate stats
  const totalCount = numbers.length;
  const suspendedCount = numbers.filter(n => n.suspended).length;
  const warningCount = numbers.filter(n => n.qualityScore < 50 && n.qualityScore >= 30 && !n.suspended).length;
  const avgQuality = numbers.length > 0
    ? Math.round(numbers.reduce((sum, n) => sum + n.qualityScore, 0) / numbers.length)
    : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
            <Shield className="h-6 w-6 md:h-8 md:w-8" />
            Number Quality Management
          </h1>
          <p className="text-sm md:text-base text-muted-foreground">
            Monitor and manage number quality scores
          </p>
        </div>
        <Button
          variant="outline"
          onClick={fetchNumbers}
          disabled={refreshing}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Numbers</CardTitle>
            <Phone className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{totalCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Suspended</CardTitle>
            <XCircle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-destructive">{suspendedCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">At Risk</CardTitle>
            <AlertTriangle className="h-4 w-4 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-orange-600">{warningCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Quality</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{avgQuality}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <Select
          value={filter}
          onValueChange={(value: any) => {
            setFilter(value);
            setPage(1);
            setSelectedNumbers(new Set());
          }}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Numbers</SelectItem>
            <SelectItem value="active">Active Only</SelectItem>
            <SelectItem value="warning">At Risk</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Bulk Actions */}
      {selectedNumbers.size > 0 && (
        <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950">
          <CardContent className="p-4">
            <div className="flex items-center gap-4 flex-wrap">
              <span className="text-blue-800 dark:text-blue-200 font-medium">
                {selectedNumbers.size} number{selectedNumbers.size > 1 ? 's' : ''} selected
              </span>
              <Button
                onClick={() => handleBulkAction('recover')}
                disabled={actionLoading}
                size="sm"
              >
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Recover
              </Button>
              <Button
                onClick={() => handleBulkAction('suspend')}
                disabled={actionLoading}
                variant="destructive"
                size="sm"
              >
                <XCircle className="h-4 w-4 mr-2" />
                Suspend
              </Button>
              <Button
                onClick={() => handleBulkAction('reset')}
                disabled={actionLoading}
                variant="outline"
                size="sm"
              >
                <Shield className="h-4 w-4 mr-2" />
                Reset Quality
              </Button>
              <Button
                onClick={() => setSelectedNumbers(new Set())}
                variant="ghost"
                size="sm"
              >
                Clear Selection
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Numbers Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 space-y-4">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center space-x-4">
                  <Skeleton className="h-4 w-4" />
                  <Skeleton className="h-12 flex-1" />
                </div>
              ))}
            </div>
          ) : numbers.length === 0 ? (
            <div className="text-center py-16">
              <Shield className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-50" />
              <p className="text-muted-foreground text-lg">No numbers found</p>
            </div>
          ) : (
            <>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[50px]">
                        <Checkbox
                          checked={selectedNumbers.size === numbers.length && numbers.length > 0}
                          onCheckedChange={handleSelectAll}
                        />
                      </TableHead>
                      <TableHead>Number</TableHead>
                      <TableHead>Quality</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Failures</TableHead>
                      <TableHead>Success</TableHead>
                      <TableHead>Last Success</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {numbers.map((number) => (
                      <TableRow key={number._id}>
                        <TableCell>
                          <Checkbox
                            checked={selectedNumbers.has(number.number)}
                            onCheckedChange={() => handleSelectNumber(number.number)}
                          />
                        </TableCell>
                        <TableCell className="font-medium">{number.number}</TableCell>
                        <TableCell>{getQualityBadge(number.qualityScore)}</TableCell>
                        <TableCell>
                          {number.suspended ? (
                            <Badge variant="destructive">
                              <XCircle className="h-3 w-3 mr-1" />
                              Suspended
                            </Badge>
                          ) : number.active ? (
                            <Badge className="bg-green-100 text-green-800 hover:bg-green-200">
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              Active
                            </Badge>
                          ) : (
                            <Badge variant="outline">Inactive</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {number.suspended ? (
                            <Badge variant="outline" className="text-xs">
                              {getSuspensionReasonBadge(number.suspensionReason)}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground text-sm">-</span>
                          )}
                        </TableCell>
                        <TableCell>{number.consecutiveFailures}</TableCell>
                        <TableCell>{number.successCount || 0}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {number.lastSuccessAt
                            ? new Date(number.lastSuccessAt).toLocaleDateString()
                            : 'Never'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between p-4">
                  <div className="text-sm text-muted-foreground">
                    Page <span className="font-medium">{page}</span> of{' '}
                    <span className="font-medium">{totalPages}</span>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page === 1}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
