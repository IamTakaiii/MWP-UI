import { useState, useEffect, useCallback, useMemo } from "react";
import { Link, useSearch, useNavigate } from "@tanstack/react-router";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  AlertCircle,
  Search,
  Calendar,
  CalendarClock,
  CalendarDays,
  Pencil,
  Trash2,
  Plus,
  Copy,
  CopyPlus,
  Download,
  ClipboardList,
  GitBranch,
} from "lucide-react";
import {
  format,
  differenceInDays,
  parseISO,
  startOfWeek,
  endOfWeek,
} from "date-fns";
import { th } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { jiraService, type WorklogEntry } from "@/services";
import { PageContainer, PageHeader } from "@/components";
import {
  WorklogDialog,
  DeleteConfirmDialog,
  BulkDeleteConfirmDialog,
  type WorklogFormData,
} from "@/components/worklog-dialog";
import { DayCard } from "@/components/history/day-card";
import {
  ContextMenu,
  useContextMenu,
  type ContextMenuAction,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { LIMITS } from "@/lib/constants";
import {
  useAuth,
  useFavoriteTasks,
  useWorklogClipboard,
} from "@/hooks";
import { useWorklogStats } from "@/hooks/use-worklog-stats";
import { formatDurationSeconds, formatTimeRange } from "@/lib/date-utils";
import { getErrorMessage } from "@/lib/error-utils";

type ViewMode = "daily" | "weekly";

export function HistoryPage() {
  // Get date from query params
  const search = useSearch({ from: "/history" });
  const dateFromQuery = search.date as string | undefined;
  const navigate = useNavigate({ from: "/history" });

  // Auth state (using centralized hook)
  const { isAuthenticated, isCheckingAuth, jiraUrl } = useAuth();

  // Clipboard hook
  const { copyWorklog, prepareForDuplicate } = useWorklogClipboard();

  // View mode
  const [viewMode, setViewMode] = useState<ViewMode>("daily");

  // Calculate current week range (Monday-Sunday) - same logic as mini history
  const getCurrentWeekRange = useCallback(() => {
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday

    // Calculate Monday of the current week
    let start: Date;
    if (dayOfWeek === 1) {
      // Today is Monday, use it as start
      start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      start.setHours(0, 0, 0, 0);
    } else {
      // Use startOfWeek to get Monday of the week containing today
      start = startOfWeek(today, { weekStartsOn: 1 });
    }

    // Always use endOfWeek to get Sunday of the week containing today
    const end = endOfWeek(today, { weekStartsOn: 1 });

    return {
      startDate: format(start, "yyyy-MM-dd"),
      endDate: format(end, "yyyy-MM-dd"),
    };
  }, []);

  // Date filter state
  const currentWeekRange = getCurrentWeekRange();
  const initialStartDate = dateFromQuery || currentWeekRange.startDate;
  const initialEndDate = dateFromQuery || currentWeekRange.endDate;

  const [startDate, setStartDate] = useState(initialStartDate);
  const [endDate, setEndDate] = useState(initialEndDate);

  // Data state
  const [worklogs, setWorklogs] = useState<WorklogEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Current day/week navigation
  const [currentDayIndex, setCurrentDayIndex] = useState(0);

  // Dialog state
  const [isWorklogDialogOpen, setIsWorklogDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedWorklog, setSelectedWorklog] = useState<WorklogEntry | null>(
    null,
  );
  const [isDuplicateMode, setIsDuplicateMode] = useState(false);
  const [isBulkDeleteDialogOpen, setIsBulkDeleteDialogOpen] = useState(false);
  const [showIssueStats, setShowIssueStats] = useState(false);

  // Favorite tasks hook
  const { recordTaskUsage } = useFavoriteTasks();

  // Context menu
  const contextMenu = useContextMenu();
  const [contextMenuWorklog, setContextMenuWorklog] =
    useState<WorklogEntry | null>(null);

  // Filter worklogs based on search query
  const filteredWorklogs = useMemo(() => {
    if (!searchQuery.trim()) return worklogs;
    const query = searchQuery.toLowerCase();
    return worklogs.filter(
      (log) =>
        log.issueKey.toLowerCase().includes(query) ||
        log.issueSummary.toLowerCase().includes(query) ||
        (log.comment && log.comment.toLowerCase().includes(query)),
    );
  }, [worklogs, searchQuery]);

  // Use the custom hook for statistics (using filtered logs)
  const { dailyWorklogs, weeklySummary } = useWorklogStats({
    worklogs: filteredWorklogs,
    startDate,
    endDate,
  });

  // Current day data (for daily view)
  const currentDay = dailyWorklogs[currentDayIndex];
  const totalDays = dailyWorklogs.length;

  // Validation
  const isDateRangeValid = startDate <= endDate;
  const dateRangeDays =
    startDate && endDate
      ? differenceInDays(parseISO(endDate), parseISO(startDate))
      : 0;
  const isWithinMonthLimit = dateRangeDays <= LIMITS.MAX_DATE_RANGE_DAYS;
  const dateError = !isDateRangeValid
    ? "วันที่เริ่มต้นต้องน้อยกว่าหรือเท่ากับวันที่สิ้นสุด"
    : !isWithinMonthLimit
      ? `ช่วงวันที่ต้องไม่เกิน ${LIMITS.MAX_DATE_RANGE_DAYS} วัน`
      : null;

  // Fetch worklogs
  const fetchData = useCallback(async () => {
    if (!isAuthenticated) {
      setError("กรุณาเข้าสู่ระบบก่อน");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const data = await jiraService.fetchWorklogHistory(startDate, endDate);
      setWorklogs(data.worklogs || []);
      // Only reset to 0 if no dateFromQuery, otherwise will be set by the effect below
      if (!dateFromQuery) {
        setCurrentDayIndex(0);
      }
    } catch (err) {
      setError(getErrorMessage(err));
      setWorklogs([]);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, startDate, endDate, dateFromQuery]);

  // Sync dates with query param ONLY if it exists
  useEffect(() => {
    if (dateFromQuery) {
      // Single day view from query param
      setStartDate(dateFromQuery);
      setEndDate(dateFromQuery);
    }
  }, [dateFromQuery]);

  // Auto fetch on mount if authenticated, or when dates change
  useEffect(() => {
    if (isAuthenticated && !isCheckingAuth) {
      fetchData();
    }
  }, [isAuthenticated, isCheckingAuth, fetchData]);

  // Find and set current day index when dateFromQuery is provided and data is loaded
  useEffect(() => {
    if (dateFromQuery && dailyWorklogs.length > 0) {
      const index = dailyWorklogs.findIndex(
        (day) => day.date === dateFromQuery,
      );
      if (index !== -1) {
        setCurrentDayIndex(index);
      }
    }
  }, [dateFromQuery, dailyWorklogs]);

  // Navigation handlers
  const goToPreviousDay = () => {
    if (currentDayIndex > 0) {
      setCurrentDayIndex((prev) => prev - 1);
    }
  };

  const goToNextDay = () => {
    if (currentDayIndex < totalDays - 1) {
      setCurrentDayIndex((prev) => prev + 1);
    }
  };

  // Generate daily summary markdown and copy to clipboard
  const handleCopyDailySummary = () => {
    if (!currentDay || currentDay.worklogs.length === 0) {
      toast.error("ไม่มี worklog ในวันที่เลือก");
      return;
    }

    // Get unique task summaries from worklogs
    const uniqueTasks = new Map<string, string>();
    for (const worklog of currentDay.worklogs) {
      if (!uniqueTasks.has(worklog.issueKey)) {
        uniqueTasks.set(worklog.issueKey, worklog.issueSummary);
      }
    }

    // Build markdown template
    const taskLines = Array.from(uniqueTasks.entries())
      .map(([key, summary]) => `- ${key} ${summary}`)
      .join("\n");

    const markdown = `เมื่อวาน
${taskLines}

วันนี้
- `;

    navigator.clipboard.writeText(markdown);
    toast.success("คัดลอกสรุปงานแล้ว", {
      description: `${uniqueTasks.size} tasks • วางใน Slack หรือ Teams ได้เลย`,
    });
  };

  const openEditDialog = (worklog: WorklogEntry) => {
    setSelectedWorklog(worklog);
    setIsWorklogDialogOpen(true);
  };

  const openDeleteDialog = (worklog: WorklogEntry) => {
    setSelectedWorklog(worklog);
    setIsDeleteDialogOpen(true);
  };

  const openBulkDeleteDialog = (worklog: WorklogEntry) => {
    setSelectedWorklog(worklog);
    setIsBulkDeleteDialogOpen(true);
  };

  // Context menu handlers (using clipboard hook)
  const handleCopyWorklog = (worklog: WorklogEntry) => {
    copyWorklog(worklog);
  };

  const handleDuplicateWorklog = (worklog: WorklogEntry) => {
    prepareForDuplicate(worklog);
    // Also open dialog for immediate use
    setSelectedWorklog(worklog);
    setIsDuplicateMode(true);
    setIsWorklogDialogOpen(true);
  };

  const getContextMenuActions = (
    worklog: WorklogEntry,
  ): ContextMenuAction[] => {
    return [
      {
        label: "คัดลอก",
        icon: <Copy className="h-4 w-4" />,
        onClick: () => handleCopyWorklog(worklog),
      },
      {
        label: "สร้างซ้ำ",
        icon: <CopyPlus className="h-4 w-4" />,
        onClick: () => handleDuplicateWorklog(worklog),
      },
      {
        label: "ลบ",
        icon: <Trash2 className="h-4 w-4" />,
        onClick: () => openDeleteDialog(worklog),
        variant: "destructive",
      },
      {
        label: "ลบทั้งหมดในช่วงนี้",
        icon: <Trash2 className="h-4 w-4" />,
        onClick: () => openBulkDeleteDialog(worklog),
        variant: "destructive",
      },
    ];
  };

  // Save worklog (create or update)
  const handleSaveWorklog = useCallback(
    async (formData: WorklogFormData) => {
      const started = `${formData.date}T${formData.startTime}:00.000+0700`;

      if (selectedWorklog && !isDuplicateMode) {
        // Update existing
        await jiraService.updateWorklog(
          selectedWorklog.issueKey,
          selectedWorklog.id,
          {
            timeSpent: formData.timeSpent,
            started,
            comment: formData.comment,
          },
        );
      } else {
        // Create new (or duplicate)
        await jiraService.createWorklog(formData.issueKey, {
          timeSpent: formData.timeSpent,
          started,
          comment: formData.comment,
        });

        // Record task usage when worklog is created successfully
        const taskForRecording = {
          id: formData.issueKey,
          key: formData.issueKey,
          fields: {
            summary: selectedWorklog?.issueSummary || "",
            status: { name: "Unknown", statusCategory: { key: "new" } },
            issuetype: { name: "Task" },
          },
        };
        recordTaskUsage(taskForRecording);
      }

      // Reset duplicate mode
      setIsDuplicateMode(false);

      // Refresh data
      await fetchData();
    },
    [selectedWorklog, isDuplicateMode, fetchData, recordTaskUsage],
  );

  // Delete worklog
  const handleDeleteWorklog = useCallback(async () => {
    if (!selectedWorklog) return;

    await jiraService.deleteWorklog(
      selectedWorklog.issueKey,
      selectedWorklog.id,
    );

    // Refresh data
    await fetchData();
  }, [selectedWorklog, fetchData]);

  // Bulk Delete worklog
  const handleBulkDeleteWorklog = useCallback(async () => {
    if (!selectedWorklog) return;

    // Find all worklogs with same issueKey in the current filtered list
    const worklogsToDelete = filteredWorklogs.filter(
      (w) => w.issueKey === selectedWorklog.issueKey,
    );
    const count = worklogsToDelete.length;

    // Execute deletes
    // We use a loop to control concurrency, though Promise.all could work too
    for (const worklog of worklogsToDelete) {
      await jiraService.deleteWorklog(worklog.issueKey, worklog.id);
    }

    toast.success(`ลบ worklog ${count} รายการเรียบร้อยแล้ว`);

    // Refresh data
    await fetchData();
  }, [selectedWorklog, filteredWorklogs, fetchData]);

  // Calculate stats by issue
  const issueStats = useMemo(() => {
    const stats = new Map<
      string,
      { summary: string; totalSeconds: number; count: number }
    >();

    filteredWorklogs.forEach((log) => {
      const current = stats.get(log.issueKey) || {
        summary: log.issueSummary,
        totalSeconds: 0,
        count: 0,
      };
      stats.set(log.issueKey, {
        summary: log.issueSummary,
        totalSeconds: current.totalSeconds + log.timeSpentSeconds,
        count: current.count + 1,
      });
    });

    return Array.from(stats.entries())
      .map(([key, data]) => ({ key, ...data }))
      .sort((a, b) => b.totalSeconds - a.totalSeconds);
  }, [filteredWorklogs]);

  return (
    <PageContainer>
      {/* Header */}
      <PageHeader
          title="Worklog History"
          description="ดูประวัติ worklog แก้ไข ลบ และตรวจสอบชั่วโมงทำงาน"
          icon={<CalendarClock className="h-5 w-5" />}
          iconGradient="from-amber-500 to-orange-500"
          actions={
            isAuthenticated && (
              <Link to="/worklog">
                <Button size="sm" className="bg-success hover:bg-success/90 gap-2">
                  <Plus className="h-4 w-4" />
                  <span className="hidden sm:inline">เพิ่ม Worklog</span>
                </Button>
              </Link>
            )
          }
        />

        {/* Date Filter Card */}
        <div className="bg-card/50 backdrop-blur-sm border border-white/10 rounded-2xl p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">ตัวกรองวันที่</h2>
            {/* View Mode Toggle */}
            <div className="flex items-center gap-1 bg-black/20 rounded-lg p-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setViewMode("daily")}
                className={cn(
                  "gap-2 rounded-md",
                  viewMode === "daily" &&
                  "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
                )}
              >
                <Calendar className="h-4 w-4" />
                รายวัน
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setViewMode("weekly")}
                className={cn(
                  "gap-2 rounded-md",
                  viewMode === "weekly" &&
                  "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
                )}
              >
                <CalendarDays className="h-4 w-4" />
                รายสัปดาห์
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <Label
                htmlFor="startDate"
                className="text-sm text-muted-foreground"
              >
                วันที่เริ่มต้น (Start Date)
              </Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => {
                  const newStartDate = e.target.value;
                  setStartDate(newStartDate);
                  // Clear the date query param when user manually changes the date
                  navigate({
                    search: (prev) => ({ ...prev, date: undefined }),
                  });
                  // If endDate is set and the range would exceed 60 days, adjust endDate
                  if (endDate && newStartDate) {
                    const daysDiff = differenceInDays(
                      parseISO(endDate),
                      parseISO(newStartDate),
                    );
                    if (daysDiff > 60) {
                      const adjustedEndDate = new Date(parseISO(newStartDate));
                      adjustedEndDate.setDate(adjustedEndDate.getDate() + 60);
                      setEndDate(format(adjustedEndDate, "yyyy-MM-dd"));
                    }
                  }
                }}
                max={endDate}
                className={cn(
                  "w-[180px] bg-black/30 border-white/20 focus:border-primary",
                  (!isDateRangeValid || !isWithinMonthLimit) &&
                  "border-destructive focus:border-destructive",
                )}
              />
            </div>
            <div className="space-y-2">
              <Label
                htmlFor="endDate"
                className="text-sm text-muted-foreground"
              >
                วันที่สิ้นสุด (End Date)
              </Label>
              <Input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => {
                  const newEndDate = e.target.value;
                  // Clear the date query param when user manually changes the date
                  navigate({
                    search: (prev) => ({ ...prev, date: undefined }),
                  });
                  // If startDate is set and the range would exceed 60 days, adjust startDate
                  if (startDate && newEndDate) {
                    const daysDiff = differenceInDays(
                      parseISO(newEndDate),
                      parseISO(startDate),
                    );
                    if (daysDiff > 60) {
                      const adjustedStartDate = new Date(parseISO(newEndDate));
                      adjustedStartDate.setDate(
                        adjustedStartDate.getDate() - 60,
                      );
                      setStartDate(format(adjustedStartDate, "yyyy-MM-dd"));
                    }
                  }
                  setEndDate(newEndDate);
                }}
                min={startDate}
                max={
                  startDate
                    ? (() => {
                      const maxDate = new Date(parseISO(startDate));
                      maxDate.setDate(maxDate.getDate() + 60);
                      return format(maxDate, "yyyy-MM-dd");
                    })()
                    : undefined
                }
                className={cn(
                  "w-[180px] bg-black/30 border-white/20 focus:border-primary",
                  (!isDateRangeValid || !isWithinMonthLimit) &&
                  "border-destructive focus:border-destructive",
                )}
              />
            </div>
            {/* Search Input */}
            <div className="space-y-2">
              <Label htmlFor="search" className="text-sm text-muted-foreground">
                ค้นหา (Issue, Summary, Comment)
              </Label>
              <div className="relative w-[250px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="search"
                  placeholder="พิมพ์คำค้นหา..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 bg-black/30 border-white/20 focus:border-primary"
                />
                {searchQuery && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 hover:bg-white/10"
                    onClick={() => setSearchQuery("")}
                  >
                    <span className="sr-only">Clear</span>
                    <span className="text-xs">✕</span>
                  </Button>
                )}
              </div>
            </div>
            <Button
              onClick={fetchData}
              disabled={
                isLoading ||
                !isAuthenticated ||
                !isDateRangeValid ||
                !isWithinMonthLimit
              }
              className="bg-primary hover:bg-primary/90 text-white disabled:opacity-50"
            >
              <Search className="h-4 w-4 mr-2" />
              {isLoading ? "กำลังค้นหา..." : "Fetch Data"}
            </Button>
            <Button
              onClick={async () => {
                try {
                  const blob = await jiraService.exportWorklogHistory(
                    startDate,
                    endDate,
                  );
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `worklog-${startDate}-${endDate}.xlsx`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                  toast.success("ดาวน์โหลดไฟล์ Excel สำเร็จ");
                } catch {
                  toast.error("ไม่สามารถ export ได้");
                }
              }}
              disabled={
                isLoading ||
                !isAuthenticated ||
                !isDateRangeValid ||
                !isWithinMonthLimit ||
                worklogs.length === 0
              }
              variant="outline"
              className="gap-2"
            >
              <Download className="h-4 w-4" />
              Export Excel
            </Button>
          </div>
          {/* Date validation error */}
          {dateError && (
            <p className="mt-3 text-sm text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              {dateError}
            </p>
          )}
        </div>

        {/* Issue Summary Stats (New Feature) */}
        {!isLoading && issueStats.length > 0 && (
          <div className="bg-card/50 backdrop-blur-sm border border-white/10 rounded-2xl p-6 mb-6">
            <div
              className="flex items-center justify-between cursor-pointer select-none"
              onClick={() => setShowIssueStats(!showIssueStats)}
            >
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <ClipboardList className="h-5 w-5 text-primary" />
                สรุปงานแยกตาม Task ({issueStats.length} งาน)
              </h2>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                {showIssueStats ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>
            </div>

            {showIssueStats && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-4 animate-in fade-in slide-in-from-top-2 duration-200">
                {issueStats.map((stat) => (
                  <div
                    key={stat.key}
                    className="p-4 rounded-xl bg-black/20 border border-white/5 hover:border-primary/30 transition-all"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="font-mono text-xs text-primary bg-primary/10 px-2 py-0.5 rounded">
                        {stat.key}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {stat.count} logs
                      </div>
                    </div>
                    <div className="text-sm font-medium line-clamp-2 mb-2 h-10">
                      {stat.summary}
                    </div>
                    <div className="flex items-end justify-between">
                      <div className="text-xs text-muted-foreground">
                        ใช้เวลา
                      </div>
                      <div className="text-lg font-bold text-success">
                        {formatDurationSeconds(stat.totalSeconds)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="mb-6 p-4 bg-destructive/10 border border-destructive/30 rounded-xl text-destructive">
            <p className="font-medium">❌ เกิดข้อผิดพลาด</p>
            <p className="text-sm mt-1">{error}</p>
          </div>
        )}

        {/* No Credentials */}
        {!isAuthenticated && !isCheckingAuth && (
          <div className="text-center py-12 bg-card/50 border border-white/10 rounded-2xl">
            <p className="text-muted-foreground mb-4">
              กรุณากรอก JIRA credentials ที่หน้า Worklog ก่อน
            </p>
            <Link to="/">
              <Button>ไปหน้า Worklog</Button>
            </Link>
          </div>
        )}

        {/* Loading State */}
        {isLoading && (
          <div className="text-center py-12">
            <div className="animate-spin text-4xl mb-4">⏳</div>
            <p className="text-muted-foreground">กำลังโหลด...</p>
          </div>
        )}

        {/* No Data */}
        {!isLoading &&
          isAuthenticated &&
          dailyWorklogs.length === 0 &&
          !error && (
            <div className="text-center py-12 bg-card/50 border border-white/10 rounded-2xl">
              <p className="text-muted-foreground">
                ไม่พบ worklog ในช่วงวันที่เลือก
              </p>
            </div>
          )}

        {/* Weekly View */}
        {!isLoading && viewMode === "weekly" && dailyWorklogs.length > 0 && (
          <>
            {/* Weekly Summary Banner */}
            {weeklySummary.isComplete ? (
              <div className="mb-6 p-5 rounded-2xl border bg-success/10 border-success/30">
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="h-8 w-8 text-success" />
                    <div>
                      <p className="text-lg font-semibold text-success">
                        ✅ ครบ {weeklySummary.targetHours} ชั่วโมงแล้ว!
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {weeklySummary.completeDays} /{" "}
                        {weeklySummary.totalWorkingDays} วันที่ครบ 8 ชม.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-32 h-3 bg-black/20 rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-success w-full" />
                    </div>
                    <span className="text-sm font-medium text-success">
                      100%
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mb-6 p-6 rounded-2xl border-2 border-dashed border-orange-500/50 bg-gradient-to-r from-orange-500/15 via-red-500/15 to-orange-500/15">
                <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="relative">
                      <AlertCircle className="h-10 w-10 text-orange-400 animate-pulse" />
                      <span className="absolute -top-1 -right-1 text-xl">
                        ⚠️
                      </span>
                    </div>
                    <div>
                      <p className="text-xl font-bold text-orange-300">
                        🚨 ยังไม่ครบ {weeklySummary.targetHours} ชั่วโมง!
                      </p>
                      <p className="text-muted-foreground">
                        {weeklySummary.completeDays} /{" "}
                        {weeklySummary.totalWorkingDays} วันที่ครบ 8 ชม.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <div className="flex items-center gap-3">
                      <span className="bg-black/30 px-3 py-1.5 rounded-lg text-sm">
                        ลงไปแล้ว:{" "}
                        <span className="font-bold text-orange-400">
                          {formatDurationSeconds(weeklySummary.totalSeconds)}
                        </span>
                      </span>
                      <span>→</span>
                      <span className="bg-red-500/20 px-3 py-1.5 rounded-lg text-sm border border-red-500/30">
                        ยังเหลือ:{" "}
                        <span className="font-bold text-red-400">
                          {formatDurationSeconds(
                            Math.max(
                              0,
                              weeklySummary.targetSeconds -
                              weeklySummary.totalSeconds,
                            ),
                          )}
                        </span>
                      </span>
                    </div>
                    <div className="flex items-center gap-2 w-full">
                      <div className="w-40 h-3 bg-black/30 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-orange-500 to-red-500 transition-all duration-500"
                          style={{
                            width: `${Math.min(100, (weeklySummary.totalSeconds / weeklySummary.targetSeconds) * 100)}%`,
                          }}
                        />
                      </div>
                      <span className="text-sm font-bold text-orange-400">
                        {Math.round(
                          (weeklySummary.totalSeconds /
                            weeklySummary.targetSeconds) *
                          100,
                        )}
                        %
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* All Days Cards */}
            <div className="space-y-4">
              {dailyWorklogs.map((day) => (
                <DayCard
                  key={day.date}
                  day={day}
                  jiraUrl={jiraUrl}
                  onEdit={openEditDialog}
                  onDelete={(worklog) => openDeleteDialog(worklog)}
                  onCopy={handleCopyWorklog}
                  onDuplicate={handleDuplicateWorklog}
                />
              ))}
            </div>
          </>
        )}

        {/* Daily View - Day Card with Navigation */}
        {!isLoading && viewMode === "daily" && currentDay && (
          <div
            className={cn(
              "bg-card/50 backdrop-blur-sm rounded-2xl overflow-hidden",
              currentDay.isComplete
                ? "border border-white/10"
                : "border-2 border-orange-500/50",
            )}
          >
            {/* Day Header */}
            <div
              className={cn(
                "p-4 md:p-5 border-b",
                currentDay.isComplete
                  ? "bg-success/10 border-white/10"
                  : "bg-gradient-to-r from-orange-500/20 via-red-500/15 to-orange-500/20 border-orange-500/30",
              )}
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg md:text-xl font-bold">
                    วันที่: {format(new Date(currentDay.date), "dd/MM/yyyy")}
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {format(new Date(currentDay.date), "EEEE", { locale: th })}
                  </p>
                </div>
                {currentDay.isComplete ? (
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-success" />
                    <span className="font-semibold text-success">
                      ครบ 8 ชม.
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 md:gap-3 bg-orange-500/20 px-3 md:px-4 py-2 rounded-xl border border-orange-500/40 self-start md:self-auto">
                    <span className="text-lg md:text-xl animate-pulse">🚨</span>
                    <AlertCircle className="h-4 w-4 md:h-5 md:w-5 text-orange-400 animate-bounce" />
                    <div className="text-right">
                      <p className="font-bold text-orange-300 text-sm md:text-base">
                        ยังไม่ครบ 8 ชม.!
                      </p>
                      <p className="text-xs text-orange-400/80">
                        เหลืออีก{" "}
                        {formatDurationSeconds(
                          LIMITS.EIGHT_HOURS_SECONDS - currentDay.totalSeconds,
                        )}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Summary & Navigation */}
              <div className="mt-4 pt-4 border-t border-white/10 space-y-3 md:space-y-0">
                {/* Mobile Layout */}
                <div className="md:hidden space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm">
                      รวมเวลาวันนี้:{" "}
                      <span
                        className={cn(
                          "font-semibold",
                          currentDay.isComplete
                            ? "text-success"
                            : "text-orange-400",
                        )}
                      >
                        {formatDurationSeconds(currentDay.totalSeconds)}
                      </span>{" "}
                      / 8h
                    </p>
                    <span className="text-sm text-muted-foreground">
                      {currentDay.worklogs.length} รายการ
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCopyDailySummary}
                      disabled={currentDay.worklogs.length === 0}
                      className="gap-1.5 border-white/20 hover:bg-white/10 hover:border-primary/50"
                      title="คัดลอกสรุปงานวันนี้"
                    >
                      <ClipboardList className="h-4 w-4" />
                      สรุปงาน
                    </Button>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={goToPreviousDay}
                        disabled={currentDayIndex <= 0}
                        className="h-8 w-8 border-white/20 hover:bg-white/10"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <span className="text-xs text-muted-foreground px-1 whitespace-nowrap">
                        {currentDayIndex + 1}/{totalDays}
                      </span>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={goToNextDay}
                        disabled={currentDayIndex >= totalDays - 1}
                        className="h-8 w-8 border-white/20 hover:bg-white/10"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Desktop Layout */}
                <div className="hidden md:flex md:items-center md:justify-between">
                  <div className="flex items-center gap-3">
                    <p className="text-sm">
                      รวมเวลาวันนี้:{" "}
                      <span
                        className={cn(
                          "font-semibold",
                          currentDay.isComplete
                            ? "text-success"
                            : "text-orange-400",
                        )}
                      >
                        {formatDurationSeconds(currentDay.totalSeconds)}
                      </span>{" "}
                      / 8h
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCopyDailySummary}
                      disabled={currentDay.worklogs.length === 0}
                      className="gap-1.5 border-white/20 hover:bg-white/10 hover:border-primary/50"
                      title="คัดลอกสรุปงานวันนี้"
                    >
                      <ClipboardList className="h-4 w-4" />
                      สรุปงาน
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      ทั้งหมด {currentDay.worklogs.length} รายการ
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={goToPreviousDay}
                      disabled={currentDayIndex <= 0}
                      className="gap-1 border-white/20 hover:bg-white/10"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      วันก่อนหน้า
                    </Button>
                    <span className="text-sm text-muted-foreground px-2">
                      ({currentDayIndex + 1} / {totalDays})
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={goToNextDay}
                      disabled={currentDayIndex >= totalDays - 1}
                      className="gap-1 border-white/20 hover:bg-white/10"
                    >
                      วันถัดไป
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {/* Worklog Table */}
            <div className="p-4 md:p-5">
              {/* Subtask Warning Banner */}
              {(() => {
                const subtaskCount = currentDay.worklogs.filter(
                  (w) => w.isSubtask,
                ).length;
                if (subtaskCount === 0) return null;
                return (
                  <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
                    <GitBranch className="h-4 w-4 shrink-0 text-amber-400" />
                    <span>
                      มี{" "}
                      <span className="font-semibold text-amber-200">
                        {subtaskCount} รายการ
                      </span>{" "}
                      ที่ลงเวลาใน{" "}
                      <span className="font-semibold text-amber-200">
                        Subtask
                      </span>{" "}
                      — ตรวจสอบว่าควรลงที่ Parent task แทน
                    </span>
                  </div>
                );
              })()}

              {/* Mobile Card Layout */}
              <div className="md:hidden space-y-3">
                {currentDay.worklogs.map((worklog) => (
                  <div
                    key={worklog.id}
                    className={cn(
                      "rounded-xl p-4 border",
                      worklog.isSubtask
                        ? "bg-amber-500/5 border-l-2 border-amber-400/60 border-white/10"
                        : "bg-white/5 border-white/10",
                    )}
                    onContextMenu={(e) => {
                      setContextMenuWorklog(worklog);
                      contextMenu.openMenu(e);
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <a
                            href={`${jiraUrl}/browse/${worklog.issueKey}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono font-semibold text-[#4C9AFF] hover:underline"
                          >
                            {worklog.issueKey}
                          </a>
                          {worklog.isSubtask && (
                            <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                              <GitBranch className="h-2.5 w-2.5" />
                              Subtask
                            </span>
                          )}
                        </div>
                        <p className="text-sm mt-1 truncate">
                          {worklog.issueSummary}
                        </p>
                        {worklog.comment && (
                          <p className="text-xs text-muted-foreground mt-1 truncate">
                            {worklog.comment}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEditDialog(worklog)}
                          className="h-8 w-8 hover:bg-white/10 hover:text-[#4C9AFF]"
                          title="แก้ไข"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openDeleteDialog(worklog)}
                          className="h-8 w-8 hover:bg-destructive/20 hover:text-destructive"
                          title="ลบ"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/10 text-sm">
                      <span className="font-mono text-muted-foreground">
                        {formatTimeRange(worklog.started, worklog.timeSpentSeconds)}
                      </span>
                      <span className="font-semibold">{worklog.timeSpent}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop Table Layout */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow className="border-white/10 hover:bg-transparent">
                      <TableHead className="w-[120px]">Issue Key</TableHead>
                      <TableHead>Task</TableHead>
                      <TableHead>Comment</TableHead>
                      <TableHead className="w-[130px]">From - To</TableHead>
                      <TableHead className="w-[80px] text-right">Time</TableHead>
                      <TableHead className="w-[100px] text-right">
                        Actions
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {currentDay.worklogs.map((worklog) => (
                      <TableRow
                        key={worklog.id}
                        className={cn(
                          "border-white/10 hover:bg-white/5 relative",
                          worklog.isSubtask &&
                            "border-l-2 border-l-amber-400/70 bg-amber-500/5 hover:bg-amber-500/10",
                        )}
                        onContextMenu={(e) => {
                          setContextMenuWorklog(worklog);
                          contextMenu.openMenu(e);
                        }}
                      >
                        <TableCell className="font-mono font-semibold text-[#4C9AFF]">
                          <div className="flex flex-col gap-1">
                            <a
                              href={`${jiraUrl}/browse/${worklog.issueKey}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:underline"
                            >
                              {worklog.issueKey}
                            </a>
                            {worklog.isSubtask && (
                              <span className="inline-flex items-center gap-1 w-fit rounded px-1.5 py-0.5 text-[10px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                <GitBranch className="h-2.5 w-2.5" />
                                Subtask
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate">
                          {worklog.issueSummary}
                        </TableCell>
                        <TableCell className="text-muted-foreground max-w-[150px] truncate">
                          {worklog.comment || "-"}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {formatTimeRange(
                            worklog.started,
                            worklog.timeSpentSeconds,
                          )}
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {worklog.timeSpent}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openEditDialog(worklog)}
                              className="h-8 w-8 hover:bg-white/10 hover:text-[#4C9AFF]"
                              title="แก้ไข"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openDeleteDialog(worklog)}
                              className="h-8 w-8 hover:bg-destructive/20 hover:text-destructive"
                              title="ลบ"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        )}

        {/* Context Menu */}
        {contextMenuWorklog && (
          <ContextMenu
            isOpen={contextMenu.isOpen}
            position={contextMenu.position}
            actions={getContextMenuActions(contextMenuWorklog)}
            onClose={() => {
              contextMenu.closeMenu();
              setContextMenuWorklog(null);
            }}
          />
        )}

        {/* Dialogs */}
        <WorklogDialog
          isOpen={isWorklogDialogOpen}
          onClose={() => {
            setIsWorklogDialogOpen(false);
            setSelectedWorklog(null);
            setIsDuplicateMode(false);
          }}
          onSave={handleSaveWorklog}
          worklog={isDuplicateMode ? null : selectedWorklog}
          issueSummary={selectedWorklog?.issueSummary}
        />

        <DeleteConfirmDialog
          isOpen={isDeleteDialogOpen}
          onClose={() => {
            setIsDeleteDialogOpen(false);
            setSelectedWorklog(null);
          }}
          onConfirm={handleDeleteWorklog}
          worklog={selectedWorklog}
        />

        <BulkDeleteConfirmDialog
          isOpen={isBulkDeleteDialogOpen}
          onClose={() => {
            setIsBulkDeleteDialogOpen(false);
            setSelectedWorklog(null);
          }}
          onConfirm={handleBulkDeleteWorklog}
          worklog={selectedWorklog}
          count={
            selectedWorklog
              ? filteredWorklogs.filter(
                (w) => w.issueKey === selectedWorklog.issueKey,
              ).length
              : 0
          }
        />
    </PageContainer>
  );
}
