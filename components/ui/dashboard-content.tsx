"use client"

import type React from "react"
import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ActivationActionChart } from "@/components/dashboard-chat"
import { TodaySuccessChart } from "@/components/bar-chart"
import { getCookie } from "@/utils/cookie"
import { Users, Activity, Building, Zap, Clock, RefreshCw, Home, BarChart3, Smartphone, TrendingUp, TrendingDown } from "lucide-react"

export default function DashboardContent() {
  const token = getCookie("token")
  const [data, setData] = useState<{
    totalNumbers: number
    activeOrders: number
    occupiedNumbers: number
    totalActivations: number
    lastcron: string
    lastsync: string
  } | null>(null)
  const [deviceStats, setDeviceStats] = useState<{
    today: { total: number; online: number; offline: number }
    yesterday: { total: number; online: number; offline: number }
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const fetchData = async () => {
    try {
      const [overviewRes, deviceRes] = await Promise.all([
        fetch("/api/overview/data", {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        }),
        fetch("/api/overview/device-stats", {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        })
      ])
      const [overview, device] = await Promise.all([overviewRes.json(), deviceRes.json()])
      setData(overview)
      setDeviceStats(device)
    } catch (err) {
      console.error("Error fetching overview:", err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  // Convert lastcron to IST with AM/PM
  const formatIST = (dateStr: string | null | undefined) => {
    if (!dateStr) return "Never"
    const date = new Date(dateStr)
    if (isNaN(date.getTime())) return "Invalid Date"
    return date.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour12: true,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    })
  }

  // Check if lastcron is older than 1 minute
  const isStale = (dateStr: string | null | undefined) => {
    if (!dateStr) return true
    const last = new Date(dateStr)
    if (isNaN(last.getTime())) return true
    return Date.now() - last.getTime() > 60 * 1000 // 1 min
  }

  return (
    <div className="flex flex-col gap-6 p-2 md:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
            <BarChart3 className="h-5 w-5 sm:h-6 sm:w-6 md:h-8 md:w-8" />
            Dashboard Overview
          </h1>
          <p className="text-sm md:text-base text-muted-foreground">
            Monitor your SMS activation system performance
          </p>
        </div>
        <Button variant="outline" onClick={() => {
          setRefreshing(true)
          fetchData()
        }} disabled={refreshing} className="w-full sm:w-auto">
          <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Last Cron Status */}
      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center gap-3">
            <Clock className="h-5 w-5" />
            <span className="font-medium">Last OTP Fetch:</span>
            <Badge variant={isStale(data?.lastcron) ? "destructive" : "default"} className="text-sm">
              {formatIST(data?.lastcron)}
              {isStale(data?.lastcron) && " (Stale)"}
            </Badge>
          </div>
          <div className="flex items-center gap-3 pl-8">
            <Clock className="h-5 w-5 opacity-50" />
            <span className="font-medium">Last Device Sync:</span>
            <Badge variant={isStale(data?.lastsync) ? "destructive" : "default"} className="text-sm">
              {formatIST(data?.lastsync)}
              {isStale(data?.lastsync) && " (Stale)"}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex justify-center items-center py-14">
          <RefreshCw className="h-10 w-10 animate-spin text-primary" />
          <span className="ml-3 text-lg text-muted-foreground">Loading dashboard data...</span>
        </div>
      ) : (
        <>
          {/* Stats Cards */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Total Numbers
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold flex items-center gap-2">
                  {data ? data.totalNumbers : "-"}
                </div>
                <p className="text-xs text-muted-foreground">Total registered numbers</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Activity className="h-4 w-4" />
                  Active Orders
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{data ? data.activeOrders : "-"}</div>
                <p className="text-xs text-muted-foreground">Currently active orders</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Building className="h-4 w-4" />
                  Occupied Numbers
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{data ? data.occupiedNumbers : "-"}</div>
                <p className="text-xs text-muted-foreground">Numbers currently in use</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Zap className="h-4 w-4" />
                  Total Activations
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{data ? data.totalActivations : "-"}</div>
                <p className="text-xs text-muted-foreground">Total successful activations</p>
              </CardContent>
            </Card>
          </div>

          {/* Device Registration Stats */}
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Smartphone className="h-4 w-4" />
                  Today Registrations
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{deviceStats ? deviceStats.today.total : "-"}</div>
                <p className="text-xs text-muted-foreground">
                  Online: {deviceStats?.today.online || 0} | Offline: {deviceStats?.today.offline || 0}
                </p>
                {deviceStats && deviceStats.yesterday.total > 0 && (
                  <div className="flex items-center mt-1">
                    {deviceStats.today.total >= deviceStats.yesterday.total ? (
                      <TrendingUp className="h-3 w-3 text-green-500 mr-1" />
                    ) : (
                      <TrendingDown className="h-3 w-3 text-red-500 mr-1" />
                    )}
                    <span className={`text-xs ${deviceStats.today.total >= deviceStats.yesterday.total ? 'text-green-600' : 'text-red-600'}`}>
                      {deviceStats.yesterday.total > 0
                        ? `${((deviceStats.today.total - deviceStats.yesterday.total) / deviceStats.yesterday.total * 100).toFixed(0)}% vs yesterday`
                        : 'New baseline'}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Yesterday
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{deviceStats ? deviceStats.yesterday.total : "-"}</div>
                <p className="text-xs text-muted-foreground">
                  Online: {deviceStats?.yesterday.online || 0} | Offline: {deviceStats?.yesterday.offline || 0}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Activity className="h-4 w-4" />
                  Today Online Rate
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">
                  {deviceStats && deviceStats.today.total > 0
                    ? `${(deviceStats.today.online / deviceStats.today.total * 100).toFixed(0)}%`
                    : "-"}
                </div>
                <p className="text-xs text-muted-foreground">
                  {deviceStats?.today.online || 0} of {deviceStats?.today.total || 0} devices online
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Building className="h-4 w-4" />
                  Yesterday Online Rate
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">
                  {deviceStats && deviceStats.yesterday.total > 0
                    ? `${(deviceStats.yesterday.online / deviceStats.yesterday.total * 100).toFixed(0)}%`
                    : "-"}
                </div>
                <p className="text-xs text-muted-foreground">
                  {deviceStats?.yesterday.online || 0} of {deviceStats?.yesterday.total || 0} devices online
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Charts */}
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-5 w-5" />
                  Activation Actions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ActivationActionChart />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Today's Success Rate
                </CardTitle>
              </CardHeader>
              <CardContent>
                <TodaySuccessChart />
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
