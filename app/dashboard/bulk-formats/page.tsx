"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { getCookie } from "@/utils/cookie";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Search, RefreshCw, Plus, Trash2, Loader2, Save, ListChecks,
  Copy, Hash, Clock, Calendar, Hash as HashIcon, AlertTriangle,
  CheckSquare, X, ImageIcon,
} from "lucide-react";
import { toast } from "sonner";

interface Service {
  _id: string;
  name: string;
  image: string;
  code: string;
  formate: string[];
  multisms: boolean;
  maxmessage: number;
  active: boolean;
}

const ITEMS_PER_PAGE = 50;

export default function BulkFormatManager() {
  const [services, setServices] = useState<Service[]>([]);
  const [formats, setFormats] = useState<string[]>([""]);
  const [showReplaceButtons, setShowReplaceButtons] = useState<boolean[]>([false]);
  const [mode, setMode] = useState<"add" | "remove">("add");
  const [search, setSearch] = useState("");
  const [onlySelected, setOnlySelected] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const token = getCookie("token");

  const textareaRefs = useRef<(HTMLTextAreaElement | null)[]>([]);

  useEffect(() => {
    fetchServices();
  }, []);

  const fetchServices = async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/services/all", {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json();
      setServices(Array.isArray(data) ? data : []);
    } catch (error) {
      toast.error("Failed to load services");
    } finally {
      setRefreshing(false);
    }
  };

  // ---------- Format inputs (same behavior as Add Service page) ----------

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>, index: number) => {
    e.preventDefault();
    const pastedText = e.clipboardData.getData("text");
    const newFormats = [...formats];
    newFormats[index] = pastedText;
    setFormats(newFormats);

    const newShow = [...showReplaceButtons];
    newShow[index] = true;
    setShowReplaceButtons(newShow);
  };

  const handleReplace = (index: number) => {
    let replacedText = formats[index];
    const otpKeywords = ["otp", "code", "password", "pass", "pin", "verification"];
    const otpRegex = new RegExp(`(${otpKeywords.join("|")})[^\\d]{0,10}(\\d{4,8})`, "i");
    const match = replacedText.match(otpRegex);

    if (match) {
      const otpValue = match[2];
      const otpNumberRegex = new RegExp(`\\b${otpValue}\\b`);
      replacedText = replacedText.replace(otpNumberRegex, "{otp}");
    } else {
      replacedText = replacedText.replace(/\b\d{4,8}\b/, "{otp}");
    }

    const newFormats = [...formats];
    newFormats[index] = replacedText;
    setFormats(newFormats);

    const newShow = [...showReplaceButtons];
    newShow[index] = false;
    setShowReplaceButtons(newShow);
  };

  const insertPlaceholder = (index: number, placeholder: string) => {
    const textarea = textareaRefs.current[index];
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const value = formats[index];

    const newValue = value.substring(0, start) + placeholder + value.substring(end);
    const newFormats = [...formats];
    newFormats[index] = newValue;
    setFormats(newFormats);

    setTimeout(() => {
      textarea.focus();
      textarea.selectionStart = textarea.selectionEnd = start + placeholder.length;
    }, 0);
  };

  const placeholders = ["{otp}", "{random}", "{date}", "{time}"];

  const addFormat = () => {
    setFormats([...formats, ""]);
    setShowReplaceButtons([...showReplaceButtons, false]);
  };

  const removeFormat = (index: number) => {
    const newFormats = formats.filter((_, i) => i !== index);
    const newShow = showReplaceButtons.filter((_, i) => i !== index);
    setFormats(newFormats.length ? newFormats : [""]);
    setShowReplaceButtons(newShow);
  };

  // ---------- Derived data ----------

  // Same normalization as the API: trim + dedupe, exact-match semantics
  const normalizedFormats = useMemo(
    () => [...new Set(formats.map((f) => f.trim()).filter(Boolean))],
    [formats]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = onlySelected ? services.filter((s) => selectedIds.has(s._id)) : services;
    if (!q) return base;
    return base.filter(
      (s) =>
        s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q)
    );
  }, [services, search, onlySelected, selectedIds]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const safePage = Math.min(currentPage, totalPages);
  const paginated = useMemo(
    () => filtered.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE),
    [filtered, safePage]
  );

  // Live count of services already containing each format
  const matchCounts = useMemo(
    () =>
      normalizedFormats.map((f) =>
        services.reduce((n, s) => n + (s.formate?.includes(f) ? 1 : 0), 0)
      ),
    [services, normalizedFormats]
  );

  const servicesContainingPrimary = useMemo(() => {
    const f = normalizedFormats[0];
    return f ? services.filter((s) => s.formate?.includes(f)) : [];
  }, [services, normalizedFormats]);

  // Selected services whose entire formate array would be drained by this remove
  const wouldEmpty = useMemo(() => {
    if (mode !== "remove" || normalizedFormats.length === 0) return 0;
    return services.filter(
      (s) =>
        selectedIds.has(s._id) &&
        s.formate?.length > 0 &&
        s.formate.every((f) => normalizedFormats.includes(f))
    ).length;
  }, [services, selectedIds, normalizedFormats, mode]);

  // ---------- Selection ----------

  const toggleOne = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  // Union/remove the whole filtered set (across all pages), keeps other selections
  const selectAllFiltered = (checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      filtered.forEach((s) => {
        if (checked) next.add(s._id);
        else next.delete(s._id);
      });
      return next;
    });
  };

  const selectContainingPrimary = () => {
    setSelectedIds(new Set(servicesContainingPrimary.map((s) => s._id)));
    setOnlySelected(false);
    setCurrentPage(1);
    toast.success(`Selected ${servicesContainingPrimary.length} services containing this format`);
  };

  const clearSelection = () => setSelectedIds(new Set());

  const pageSelectedCount = paginated.filter((s) => selectedIds.has(s._id)).length;
  const pageCheckboxState: boolean | "indeterminate" =
    paginated.length === 0
      ? false
      : pageSelectedCount === paginated.length
        ? true
        : pageSelectedCount > 0
          ? "indeterminate"
          : false;

  // ---------- Apply ----------

  const canApply = normalizedFormats.length > 0 && selectedIds.size > 0 && !loading;

  const handleApply = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/services/bulk-formats", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          serviceIds: [...selectedIds],
          formats: normalizedFormats,
          mode,
        }),
      });

      const result = await res.json();
      if (result.success) {
        toast.success(
          `${result.modified} of ${result.requested} services ${
            mode === "add" ? "updated" : "cleaned"
          }`
        );
        setSelectedIds(new Set());
        setFormats([""]);
        setShowReplaceButtons([false]);
        setConfirmOpen(false);
        await fetchServices();
      } else {
        toast.error(result.error || "Bulk update failed");
      }
    } catch (error) {
      toast.error("Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
            <ListChecks className="h-6 w-6 md:h-8 md:w-8" />
            Bulk Format Manager
          </h1>
          <p className="text-sm md:text-base text-muted-foreground">
            Add or remove a format on many services at once — existing formats are never
            touched when adding
          </p>
        </div>
        <Button variant="outline" onClick={fetchServices} disabled={refreshing}>
          <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Mode toggle */}
      <Tabs value={mode} onValueChange={(v) => setMode(v as "add" | "remove")}>
        <TabsList className="h-10">
          <TabsTrigger value="add" className="px-4">
            <Plus className="h-4 w-4 mr-2" />
            Add to services
          </TabsTrigger>
          <TabsTrigger value="remove" className="px-4">
            <Trash2 className="h-4 w-4 mr-2" />
            Remove from services
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Format input */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Copy className="h-5 w-5" />
            {mode === "add" ? "Formats to Add" : "Formats to Remove"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {formats.map((format, index) => (
            <div key={index} className="relative border p-3 rounded-lg">
              <Textarea
                ref={(el) => {
                  textareaRefs.current[index] = el;
                }}
                value={format}
                onChange={(e) => {
                  const newFormats = [...formats];
                  newFormats[index] = e.target.value;
                  setFormats(newFormats);
                }}
                onPaste={(e) => handlePaste(e, index)}
                placeholder={
                  mode === "add"
                    ? `Paste format #${index + 1} here... (e.g. Grow More, or a full SMS template with {otp})`
                    : `Paste format #${index + 1} to remove... (must match exactly)`
                }
                className="min-h-[100px] mb-2"
              />
              {showReplaceButtons[index] && (
                <Button type="button" onClick={() => handleReplace(index)} className="mt-2">
                  <Copy className="h-4 w-4 mr-2" />
                  Auto-replace OTP With <code className="ml-1">{"{otp}"}</code>
                </Button>
              )}
              <div className="flex flex-wrap gap-2 mt-3">
                {placeholders.map((ph) => (
                  <Button
                    key={ph}
                    type="button"
                    onClick={() => insertPlaceholder(index, ph)}
                    size="sm"
                    variant="outline"
                  >
                    {ph === "{otp}" && <HashIcon className="h-3 w-3 mr-1" />}
                    {ph === "{random}" && <Hash className="h-3 w-3 mr-1" />}
                    {ph === "{date}" && <Calendar className="h-3 w-3 mr-1" />}
                    {ph === "{time}" && <Clock className="h-3 w-3 mr-1" />}
                    {ph}
                  </Button>
                ))}
              </div>
              <Button
                type="button"
                onClick={() => removeFormat(index)}
                variant="destructive"
                size="sm"
                className="absolute bottom-3 right-3"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button type="button" onClick={addFormat} variant="outline">
            <Plus className="h-4 w-4 mr-2" />
            Add Another Format
          </Button>

          {/* Live match helper for the first format */}
          {normalizedFormats.length > 0 && (
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-lg border bg-muted/40 p-3">
              <Badge variant="secondary" className="w-fit">
                &quot;{normalizedFormats[0].length > 40
                  ? normalizedFormats[0].slice(0, 40) + "…"
                  : normalizedFormats[0]}
                &quot; is on {matchCounts[0]} services
              </Badge>
              <Button
                size="sm"
                variant="outline"
                onClick={selectContainingPrimary}
                disabled={servicesContainingPrimary.length === 0}
                className="w-fit"
              >
                <CheckSquare className="h-4 w-4 mr-2" />
                Select services containing this format
              </Button>
              {normalizedFormats.length > 1 && (
                <span className="text-xs text-muted-foreground">
                  + {normalizedFormats.length - 1} more format(s) will be{" "}
                  {mode === "add" ? "added" : "removed"} together
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Service selection */}
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 sm:px-6">
          <CardTitle>Select Services</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{selectedIds.size} selected</Badge>
            <Badge variant="secondary">{filtered.length} shown</Badge>
            <Badge variant="outline">{services.length} total</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or code..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setCurrentPage(1);
                }}
                className="pl-10"
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="only-selected"
                checked={onlySelected}
                onCheckedChange={(v) => {
                  setOnlySelected(v);
                  setCurrentPage(1);
                }}
              />
              <Label htmlFor="only-selected" className="whitespace-nowrap">
                Show selected only
              </Label>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => selectAllFiltered(true)}
              disabled={filtered.length === 0}
            >
              <CheckSquare className="h-4 w-4 mr-2" />
              Select all {filtered.length} matching
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => selectAllFiltered(false)}
              disabled={filtered.length === 0}
            >
              <X className="h-4 w-4 mr-2" />
              Deselect all matching
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={clearSelection}
              disabled={selectedIds.size === 0}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Clear selection
            </Button>
          </div>

          {refreshing && services.length === 0 ? (
            <div className="flex justify-center items-center py-14">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="ml-3 text-muted-foreground">Loading services...</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16">
              <ListChecks className="h-16 w-16 mx-auto mb-4 opacity-50" />
              <p className="text-muted-foreground text-lg">No services found</p>
            </div>
          ) : (
            <>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">
                        <Checkbox
                          checked={pageCheckboxState}
                          onCheckedChange={(c) => {
                            const checked = c === true;
                            paginated.forEach((s) => toggleOne(s._id, checked));
                          }}
                        />
                      </TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Image</TableHead>
                      <TableHead>Code</TableHead>
                      <TableHead>Formats</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginated.map((service) => {
                      const isSelected = selectedIds.has(service._id);
                      return (
                        <TableRow
                          key={service._id}
                          className={`cursor-pointer ${isSelected ? "bg-muted/50" : ""}`}
                          onClick={() => toggleOne(service._id, !isSelected)}
                        >
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={(c) => toggleOne(service._id, c === true)}
                            />
                          </TableCell>
                          <TableCell className="font-medium">{service.name}</TableCell>
                          <TableCell>
                            {service.image ? (
                              <img src={service.image} alt="icon" className="w-6 h-6 rounded" />
                            ) : (
                              <ImageIcon className="w-6 h-6 text-muted-foreground" />
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{service.code}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary">
                              {service.formate?.length || 0} templates
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant={service.active ? "default" : "destructive"}>
                              {service.active ? "Active" : "Inactive"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              <div className="flex justify-center mt-6 gap-2 flex-wrap">
                {Array.from({ length: totalPages }).map((_, idx) => (
                  <Button
                    key={idx}
                    size="sm"
                    variant={safePage === idx + 1 ? "default" : "outline"}
                    onClick={() => setCurrentPage(idx + 1)}
                  >
                    {idx + 1}
                  </Button>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Apply */}
      <Button
        onClick={() => setConfirmOpen(true)}
        disabled={!canApply}
        className="w-full"
        size="lg"
        variant={mode === "add" ? "default" : "destructive"}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        ) : (
          <Save className="h-4 w-4 mr-2" />
        )}
        {mode === "add"
          ? `Add ${normalizedFormats.length || ""} format(s) to ${selectedIds.size} services`
          : `Remove ${normalizedFormats.length || ""} format(s) from ${selectedIds.size} services`}
      </Button>

      {/* Confirm dialog */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {mode === "add" ? "Add formats to services?" : "Remove formats from services?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {mode === "add"
                ? "The format(s) will be appended to each selected service. Formats already present are skipped — nothing existing is removed."
                : "The exact format string(s) will be removed from each selected service. Other formats are kept."}
              <br />
              <br />
              <strong>{selectedIds.size}</strong> services ·{" "}
              <strong>{normalizedFormats.length}</strong> format(s):{" "}
              {normalizedFormats[0]?.length > 60
                ? `"${normalizedFormats[0].slice(0, 60)}…"`
                : `"${normalizedFormats[0]}"`}
              {normalizedFormats.length > 1 &&
                ` + ${normalizedFormats.length - 1} more`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {wouldEmpty > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                Warning: <strong>{wouldEmpty}</strong> selected service(s) will end up with{" "}
                <strong>zero formats</strong> after this removal — they will no longer match
                any SMS.
              </span>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleApply();
              }}
              className={
                mode === "add"
                  ? ""
                  : "bg-destructive text-destructive-foreground hover:bg-destructive/90"
              }
            >
              {loading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              {mode === "add" ? "Add Formats" : "Remove Formats"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
