'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Card, CardContent, CardHeader, CardTitle,
} from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { DeviceCard } from './device-card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Smartphone, Plus, Search, RefreshCw, Wifi, WifiOff,
  AlertTriangle, Download, Radio, PhoneForwarded, PhoneOff,
} from 'lucide-react'
import { toast } from 'sonner'

interface Device {
  _id: string
  deviceId: string
  name: string
  status: 'online' | 'offline' | 'error'
  lastSeen: string
  batteryLevel?: number
  isCharging: boolean
  signalStrength: number
  networkType: 'wifi' | 'mobile' | 'none'
  deviceModel?: string
  manufacturer?: string
  sims: Array<{
    slot: number
    phoneNumber?: string
    carrier?: string
    isActive: boolean
    callForwardingActive?: boolean
    callForwardingTo?: string
  }>
  recentMessages: number
  timeSinceLastSeen: { minutes: number; hours: number; days: number }
}

interface DeviceStats {
  total: number
  online: number
  offline: number
  error: number
  totalMessages: number
}

export function DeviceList() {
  const [devices, setDevices] = useState<Device[]>([])
  const [stats, setStats] = useState<DeviceStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [sortBy, setSortBy] = useState('lastSeen')
  const [sortOrder] = useState('desc')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [wsConnected, setWsConnected] = useState(false)

  // FIX: forwardPhoneNumber is a separate controlled string so the Input is
  // a proper controlled component and the value is always up to date when
  // the confirm button fires.
  const [forwardPhoneNumber, setForwardPhoneNumber] = useState('')
  const [callForwardingDialog, setCallForwardingDialog] = useState<{
    open: boolean
    deviceId: string
    simSlot: number
    action: 'forward' | 'deactivate'
  }>({ open: false, deviceId: '', simSlot: 0, action: 'forward' })

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<NodeJS.Timeout | null>(null)

  // ─── REST API ──────────────────────────────────────────────────────────────

  const fetchDevices = useCallback(async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '20',
        sortBy,
        sortOrder,
        ...(statusFilter !== 'all' && { status: statusFilter }),
        ...(searchTerm && { search: searchTerm }),
      })
      const response = await fetch(`/api/device/list?${params}`)
      const result = await response.json()
      if (result.success) {
        setDevices(result.data.devices)
        setStats(result.data.stats)
        setTotalPages(result.data.pagination.pages)
      } else {
        toast.error('Failed to fetch devices')
      }
    } catch (error) {
      console.error('Error fetching devices:', error)
      toast.error('Error fetching devices')
    } finally {
      setLoading(false)
    }
  }, [page, statusFilter, sortBy, sortOrder, searchTerm])

  // ─── WebSocket ─────────────────────────────────────────────────────────────

  const connectWebSocket = useCallback(() => {
    if (typeof window === 'undefined') return
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(`${protocol}//${window.location.host}/gateway?client=dashboard`)
      wsRef.current = ws

      ws.onopen = () => {
        setWsConnected(true)
        if (reconnectTimer.current) {
          clearTimeout(reconnectTimer.current)
          reconnectTimer.current = null
        }
      }

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data)
          switch (message.type) {
            case 'device_status': {
              const { deviceId, name, status, batteryLevel, isCharging, signalStrength, networkType, lastSeen } = message.data
              setDevices(prev => {
                const exists = prev.find(d => d.deviceId === deviceId)
                if (!exists) { fetchDevices(); return prev }
                const now = new Date()
                const lastSeenDate = new Date(lastSeen)
                const diffMs = now.getTime() - lastSeenDate.getTime()
                const diffMins = Math.floor(diffMs / 60000)
                const diffHours = Math.floor(diffMs / 3600000)
                const diffDays = Math.floor(diffMs / 86400000)

                return prev.map(d =>
                  d.deviceId === deviceId
                    ? {
                        ...d,
                        status,
                        lastSeen,
                        timeSinceLastSeen: {
                          minutes: diffMins % 60,
                          hours: diffHours % 24,
                          days: diffDays
                        },
                        ...(batteryLevel !== undefined && { batteryLevel }),
                        ...(isCharging !== undefined && { isCharging }),
                        ...(signalStrength !== undefined && { signalStrength }),
                        ...(networkType !== undefined && { networkType })
                      }
                    : d
                )
              })
              setStats(prev => {
                if (!prev) return prev
                const isNowOnline = status === 'online'
                return { ...prev,
                  online: isNowOnline ? prev.online + 1 : Math.max(0, prev.online - 1),
                  offline: isNowOnline ? Math.max(0, prev.offline - 1) : prev.offline + 1,
                }
              })
              toast[status === 'online' ? 'success' : 'warning'](`${name || deviceId} is now ${status}`, { duration: 3000 })
              break
            }
            case 'device_heartbeat': {
              const { deviceId, batteryLevel, isCharging, signalStrength, networkType, lastSeen } = message.data
              const now = new Date()
              const lastSeenDate = new Date(lastSeen)
              const diffMs = now.getTime() - lastSeenDate.getTime()
              const diffMins = Math.floor(diffMs / 60000)
              const diffHours = Math.floor(diffMs / 3600000)
              const diffDays = Math.floor(diffMs / 86400000)

              setDevices(prev => prev.map(d =>
                d.deviceId === deviceId
                  ? {
                      ...d,
                      batteryLevel,
                      isCharging,
                      signalStrength,
                      networkType,
                      lastSeen,
                      timeSinceLastSeen: {
                        minutes: diffMins % 60,
                        hours: diffHours % 24,
                        days: diffDays
                      }
                    }
                  : d
              ))
              break
            }
            case 'sms_received': {
              const { deviceId, sender } = message.data
              setDevices(prev => prev.map(d =>
                d.deviceId === deviceId ? { ...d, recentMessages: (d.recentMessages || 0) + 1 } : d
              ))
              setStats(prev => prev ? { ...prev, totalMessages: prev.totalMessages + 1 } : prev)
              toast.info(`New SMS from ${sender}`, { duration: 3000 })
              break
            }
            case 'call_forwarding_response': {
              const { deviceId, action, success, simSlot, phoneNumber, error } = message.data
              setDevices(prev => prev.map(d =>
                d.deviceId === deviceId
                  ? { ...d, sims: d.sims.map((sim) =>
                      sim.slot === simSlot + 1
                        ? { ...sim,
                            callForwardingActive: success && action === 'forward',
                            callForwardingTo: success && action === 'forward' ? phoneNumber : undefined }
                        : sim
                    )}
                  : d
              ))
              if (success) {
                toast.success(action === 'forward' ? 'Call forwarding activated' : 'Call forwarding deactivated')
              } else {
                toast.error(error || 'Call forwarding failed')
              }
              break
            }
          }
        } catch (e) {
          console.warn('Error parsing WebSocket message:', e)
        }
      }

      ws.onclose = () => {
        setWsConnected(false)
        wsRef.current = null
        reconnectTimer.current = setTimeout(connectWebSocket, 3000)
      }

      ws.onerror = () => {
        console.warn('Dashboard WebSocket error - will reconnect')
        setWsConnected(false)
      }
    } catch {
      reconnectTimer.current = setTimeout(connectWebSocket, 3000)
    }
  }, [fetchDevices])

  useEffect(() => {
    connectWebSocket()
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [connectWebSocket])

  useEffect(() => { fetchDevices() }, [fetchDevices])

  // ─── Handlers ──────────────────────────────────────────────────────────────

  // Sends the actual API request — called only from confirmed dialog or deactivate.
  const sendCallForwardingCommand = async (
    deviceId: string,
    simSlot: number,
    action: 'forward' | 'deactivate',
    phoneNumber?: string
  ) => {
    try {
      const response = await fetch(`/api/device/${deviceId}/call-forwarding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, simSlot, ...(action === 'forward' && { phoneNumber }) }),
      })
      const result = await response.json()
      if (result.success) {
        toast.success(action === 'forward' ? `Forwarding to ${phoneNumber}` : 'Call forwarding deactivated')
        setDevices(prev => prev.map(d =>
          d.deviceId === deviceId
            ? { ...d, sims: d.sims.map((sim) =>
                sim.slot === simSlot + 1
                  ? { ...sim,
                      callForwardingActive: action === 'forward',
                      callForwardingTo: action === 'forward' ? phoneNumber : undefined }
                  : sim
              )}
            : d
        ))
      } else {
        toast.error(result.error || 'Failed to send call forwarding command')
      }
    } catch (error) {
      console.error('Error sending call forwarding command:', error)
      toast.error('Error sending call forwarding command')
    }
  }

  // FIX: This is the handler passed to DeviceCard.
  // For 'forward': opens the dialog to collect a phone number first.
  // If currentNumber is provided, pre-fills the dialog for editing.
  // For 'deactivate': sends immediately (no phone number needed).
  const handleCallForwarding = (
    deviceId: string,
    simSlot: number,
    action: 'forward' | 'deactivate',
    currentNumber?: string,
  ) => {
    if (action === 'forward') {
      // If currentNumber is provided, pre-fill the dialog (edit mode)
      // Remove the +91 prefix for the input field
      const numberWithoutPrefix = currentNumber?.replace('+91 ', '') || ''
      setForwardPhoneNumber(numberWithoutPrefix)
      setCallForwardingDialog({ open: true, deviceId, simSlot, action: 'forward' })
    } else {
      sendCallForwardingCommand(deviceId, simSlot, 'deactivate')
    }
  }

  const handleDeleteDevice = (device: Device) => {
    setSelectedDevice(device)
    setDeleteDialogOpen(true)
  }

  const confirmDelete = async () => {
    if (!selectedDevice) return
    try {
      const response = await fetch(`/api/device/${selectedDevice.deviceId}`, { method: 'DELETE' })
      const result = await response.json()
      if (result.success) {
        toast.success('Device deleted successfully')
        setDeleteDialogOpen(false)
        setSelectedDevice(null)
        fetchDevices()
      } else {
        toast.error(result.error || 'Failed to delete device')
      }
    } catch (error) {
      console.error('Error deleting device:', error)
      toast.error('Error deleting device')
    }
  }

  const handleToggleStatus = async (device: Device) => {
    try {
      const newStatus = device.status === 'online' ? 'offline' : 'online'
      const response = await fetch(`/api/device/${device.deviceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      const result = await response.json()
      if (result.success) {
        toast.success(`Device ${newStatus === 'online' ? 'activated' : 'deactivated'} successfully`)
        fetchDevices()
      } else {
        toast.error(result.error || 'Failed to update device status')
      }
    } catch (error) {
      console.error('Error updating device status:', error)
      toast.error('Error updating device status')
    }
  }

  const exportDevices = async () => {
    try {
      const response = await fetch('/api/device/list?limit=1000')
      const result = await response.json()
      if (result.success) {
        const csv = [
          ['Device ID', 'Name', 'Status', 'Last Seen', 'Battery', 'Network', 'Model'].join(','),
          ...result.data.devices.map((d: Device) => [
            d.deviceId, d.name, d.status,
            new Date(d.lastSeen).toISOString(),
            d.batteryLevel ?? 'N/A', d.networkType, d.deviceModel ?? 'N/A',
          ].join(','))
        ].join('\n')
        const blob = new Blob([csv], { type: 'text/csv' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `devices_${new Date().toISOString().split('T')[0]}.csv`
        a.click()
        URL.revokeObjectURL(url)
      }
    } catch (error) {
      console.error('Error exporting devices:', error)
      toast.error('Error exporting devices')
    }
  }

  // ─── Loading skeleton ──────────────────────────────────────────────────────

  if (loading && page === 1) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2"><Skeleton className="h-4 w-20" /></CardHeader>
              <CardContent><Skeleton className="h-8 w-16" /></CardContent>
            </Card>
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <Card key={i}>
              <CardHeader><Skeleton className="h-6 w-32" /></CardHeader>
              <CardContent className="space-y-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  // ─── UI ────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* Stats */}
      {stats && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          {[
            { label: 'Total Devices', value: stats.total, icon: <Smartphone className="h-4 w-4 text-muted-foreground" /> },
            { label: 'Online', value: stats.online, icon: <Wifi className="h-4 w-4 text-green-500" />, color: 'text-green-600' },
            { label: 'Offline', value: stats.offline, icon: <WifiOff className="h-4 w-4 text-gray-500" />, color: 'text-gray-600' },
            { label: 'Error', value: stats.error, icon: <AlertTriangle className="h-4 w-4 text-red-500" />, color: 'text-red-600' },
            { label: 'Messages (24h)', value: stats.totalMessages },
          ].map(({ label, value, icon, color }) => (
            <Card key={label}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{label}</CardTitle>
                {icon}
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${color ?? ''}`}>{value}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-1 flex-col gap-2 md:flex-row md:gap-2">
          <div className="relative flex-1 md:max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search devices..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full md:w-32"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="online">Online</SelectItem>
              <SelectItem value="offline">Offline</SelectItem>
              <SelectItem value="error">Error</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-full md:w-32"><SelectValue placeholder="Sort by" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="lastSeen">Last Seen</SelectItem>
              <SelectItem value="name">Name</SelectItem>
              <SelectItem value="status">Status</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <Radio className={`h-3 w-3 ${wsConnected ? 'text-green-500 animate-pulse' : 'text-gray-400'}`} />
            <span>{wsConnected ? 'Live' : 'Offline'}</span>
          </div>
          <Button variant="outline" onClick={fetchDevices} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button variant="outline" onClick={exportDevices}>
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            Add Device
          </Button>
        </div>
      </div>

      {/* Device grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {devices.map((device) => (
          <DeviceCard
            key={device._id}
            device={device}
            onEdit={(d) => toast.info(`Edit device: ${d.name}`)}
            onDelete={handleDeleteDevice}
            onToggleStatus={handleToggleStatus}
            onCallForwarding={handleCallForwarding}
          />
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center">
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
              Previous
            </Button>
            <span className="flex items-center px-4 text-sm text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <Button variant="outline" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && devices.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Smartphone className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No devices found</h3>
            <p className="text-muted-foreground text-center mb-4">
              {searchTerm || statusFilter !== 'all'
                ? 'Try adjusting your search filters'
                : 'Get started by adding your first device'}
            </p>
            {!searchTerm && statusFilter === 'all' && (
              <Button><Plus className="h-4 w-4 mr-2" />Add Device</Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Call Forwarding Dialog ───────────────────────────────────────────── */}
      {/* FIX: dialog is now the ONLY path for 'forward' — DeviceCard no longer
          calls the API directly. Phone number is collected here before anything
          is sent to the device. forwardPhoneNumber is controlled state so the
          confirm button always reads the latest typed value. */}
      <Dialog
        open={callForwardingDialog.open}
        onOpenChange={(open) => setCallForwardingDialog(prev => ({ ...prev, open }))}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {callForwardingDialog.action === 'forward' ? 'Forward calls' : 'Deactivate call forwarding'}
            </DialogTitle>
            <DialogDescription>
              {callForwardingDialog.action === 'forward'
                ? `Enter the number to forward SIM ${callForwardingDialog.simSlot + 1} calls to.`
                : `Deactivate call forwarding for SIM ${callForwardingDialog.simSlot + 1}?`}
            </DialogDescription>
          </DialogHeader>

          {callForwardingDialog.action === 'forward' && (
            <div className="space-y-2 py-2">
              <Label htmlFor="forward-number">Forward to number</Label>
              <div className="flex">
                <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 border-input bg-muted text-muted-foreground text-sm">
                  +91
                </span>
                <Input
                  id="forward-number"
                  placeholder="9876543210"
                  value={forwardPhoneNumber.replace('+91 ', '')}
                  onChange={(e) => setForwardPhoneNumber(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && forwardPhoneNumber.trim()) {
                      sendCallForwardingCommand(
                        callForwardingDialog.deviceId,
                        callForwardingDialog.simSlot,
                        'forward',
                        '+91 ' + forwardPhoneNumber.trim()
                      )
                      setCallForwardingDialog({ open: false, deviceId: '', simSlot: 0, action: 'forward' })
                    }
                  }}
                  autoFocus
                  className="rounded-l-none"
                />
              </div>
              <p className="text-xs text-muted-foreground">Enter 10-digit mobile number (India)</p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => setCallForwardingDialog({ open: false, deviceId: '', simSlot: 0, action: 'forward' })}
            >
              Cancel
            </Button>
            {callForwardingDialog.action === 'forward' ? (
              <Button
                disabled={!forwardPhoneNumber.trim()}
                onClick={() => {
                  sendCallForwardingCommand(
                    callForwardingDialog.deviceId,
                    callForwardingDialog.simSlot,
                    'forward',
                    '+91 ' + forwardPhoneNumber.trim()
                  )
                  setCallForwardingDialog({ open: false, deviceId: '', simSlot: 0, action: 'forward' })
                }}
              >
                <PhoneForwarded className="h-4 w-4 mr-2" />
                Activate forwarding
              </Button>
            ) : (
              <Button
                variant="destructive"
                onClick={() => {
                  sendCallForwardingCommand(
                    callForwardingDialog.deviceId,
                    callForwardingDialog.simSlot,
                    'deactivate'
                  )
                  setCallForwardingDialog({ open: false, deviceId: '', simSlot: 0, action: 'forward' })
                }}
              >
                <PhoneOff className="h-4 w-4 mr-2" />
                Deactivate
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete device</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{selectedDevice?.name}&quot;?
              This will also remove all associated messages and cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDelete}>Delete</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}