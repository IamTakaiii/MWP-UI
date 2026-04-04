import { useState } from "react";
import { format } from "date-fns";
import { th } from "date-fns/locale";
import {
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  Pencil,
  Trash2,
  Copy,
  CopyPlus,
  GitBranch,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ContextMenu,
  useContextMenu,
  type ContextMenuAction,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { formatDurationSeconds, formatTimeRange } from "@/lib/date-utils";
import type { WorklogEntry, DailyWorklog } from "@/services";

interface DayCardProps {
  day: DailyWorklog;
  jiraUrl: string;
  onEdit: (worklog: WorklogEntry) => void;
  onDelete: (worklog: WorklogEntry) => void;
  onCopy: (worklog: WorklogEntry) => void;
  onDuplicate: (worklog: WorklogEntry) => void;
}

export function DayCard({
  day,
  jiraUrl,
  onEdit,
  onDelete,
  onCopy,
  onDuplicate,
}: DayCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const contextMenu = useContextMenu();
  const [contextMenuWorklog, setContextMenuWorklog] =
    useState<WorklogEntry | null>(null);

  const getContextMenuActions = (
    worklog: WorklogEntry,
  ): ContextMenuAction[] => {
    return [
      {
        label: "คัดลอก",
        icon: <Copy className="h-4 w-4" />,
        onClick: () => onCopy(worklog),
      },
      {
        label: "สร้างซ้ำ",
        icon: <CopyPlus className="h-4 w-4" />,
        onClick: () => onDuplicate(worklog),
      },
      {
        label: "ลบ",
        icon: <Trash2 className="h-4 w-4" />,
        onClick: () => onDelete(worklog),
        variant: "destructive",
      },
    ];
  };

  return (
    <div
      className={cn(
        "bg-card/50 backdrop-blur-sm border rounded-2xl overflow-hidden transition-all",
        day.isComplete ? "border-success/30" : "border-white/10",
      )}
    >
      {/* Day Header - Clickable */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          "w-full p-4 flex items-center justify-between text-left transition-colors",
          day.isComplete
            ? "bg-success/10 hover:bg-success/15"
            : "bg-black/20 hover:bg-black/30",
        )}
      >
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "w-10 h-10 rounded-xl flex items-center justify-center font-bold text-lg",
              day.isComplete
                ? "bg-success/20 text-success"
                : "bg-white/10 text-muted-foreground",
            )}
          >
            {format(new Date(day.date), "d")}
          </div>
          <div>
            <p className="font-semibold">
              {format(new Date(day.date), "EEEE", { locale: th })}
            </p>
            <p className="text-sm text-muted-foreground">
              {format(new Date(day.date), "d MMMM yyyy", { locale: th })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {day.worklogs.length} รายการ
          </span>
          <span
            className={cn(
              "font-semibold",
              day.isComplete ? "text-success" : "text-warning",
            )}
          >
            {formatDurationSeconds(day.totalSeconds)}
          </span>
          {day.isComplete ? (
            <CheckCircle2 className="h-5 w-5 text-success" />
          ) : (
            <AlertCircle className="h-5 w-5 text-warning" />
          )}
          <ChevronRight
            className={cn(
              "h-5 w-5 text-muted-foreground transition-transform",
              isExpanded && "rotate-90",
            )}
          />
        </div>
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="p-4 border-t border-white/10">
          {/* Subtask Warning Banner */}
          {(() => {
            const subtaskCount = day.worklogs.filter((w) => w.isSubtask).length;
            if (subtaskCount === 0) return null;
            return (
              <div className="mb-3 flex items-center gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-300">
                <GitBranch className="h-4 w-4 shrink-0 text-amber-400" />
                <span>
                  มี{" "}
                  <span className="font-semibold text-amber-200">
                    {subtaskCount} รายการ
                  </span>{" "}
                  ที่ลงเวลาใน{" "}
                  <span className="font-semibold text-amber-200">Subtask</span>{" "}
                  — ตรวจสอบว่าควรลงที่ Parent task แทน
                </span>
              </div>
            );
          })()}
          <Table>
            <TableHeader>
              <TableRow className="border-white/10 hover:bg-transparent">
                <TableHead className="w-[100px]">Issue</TableHead>
                <TableHead>Task</TableHead>
                <TableHead className="w-[120px]">เวลา</TableHead>
                <TableHead className="w-[70px] text-right">ระยะเวลา</TableHead>
                <TableHead className="w-[90px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {day.worklogs.map((worklog) => (
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
                  <TableCell className="truncate max-w-[200px]">
                    {worklog.issueSummary}
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {formatTimeRange(worklog.started, worklog.timeSpentSeconds)}
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    {worklog.timeSpent}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEdit(worklog);
                        }}
                        className="h-7 w-7 hover:bg-white/10 hover:text-[#4C9AFF]"
                        title="แก้ไข"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(worklog);
                        }}
                        className="h-7 w-7 hover:bg-destructive/20 hover:text-destructive"
                        title="ลบ"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
    </div>
  );
}
