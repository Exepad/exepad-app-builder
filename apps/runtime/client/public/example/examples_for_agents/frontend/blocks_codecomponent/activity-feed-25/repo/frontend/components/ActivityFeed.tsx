import {
  React,
  useArrayState,
  useHandler,
  useAppState,
  format,
  Item,
  ItemMedia,
  ItemContent,
  ItemActions,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
  ItemDescription,
  ItemHeader,
  ItemFooter,
  Avatar,
  AvatarFallback,
  Button,
  Skeleton,
  ScrollArea,
  Badge,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Icons,
  cn,
} from "@exepad/sdk";

interface ActivityItem {
  id: string;
  actor: string;
  initials: string;
  action: "commented" | "pushed" | "merged" | "reviewed";
  target: string;
  description: string;
  timestamp: number;
  likes: number;
  replies: number;
  liked: boolean;
  bookmarked: boolean;
}

const ACTION_LABELS: Record<ActivityItem["action"], string> = {
  commented: "commented on",
  pushed: "pushed to",
  merged: "merged",
  reviewed: "reviewed",
};

const ACTION_COLORS: Record<ActivityItem["action"], string> = {
  commented: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  pushed: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  merged: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300",
  reviewed: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300",
};

const now = Date.now();
const hour = 3600000;
const day = 86400000;

const INITIAL_ACTIVITIES: ActivityItem[] = [
  { id: "1", actor: "Alice Johnson", initials: "AJ", action: "commented", target: "Issue #142: Fix login redirect", description: "We should also handle the case where the session token has expired. I'll add a check for that in the middleware.", timestamp: now - hour * 1, likes: 3, replies: 1, liked: false, bookmarked: false },
  { id: "2", actor: "Bob Smith", initials: "BS", action: "pushed", target: "feature/auth-refactor", description: "Added OAuth2 PKCE flow support with refresh token rotation. 12 files changed, 847 insertions, 203 deletions.", timestamp: now - hour * 2, likes: 7, replies: 2, liked: true, bookmarked: false },
  { id: "3", actor: "Carol Davis", initials: "CD", action: "merged", target: "PR #89: Database migration optimization", description: "Merged after 3 approvals. Migration time reduced from 45s to 8s by batching ALTER TABLE statements.", timestamp: now - hour * 4, likes: 12, replies: 4, liked: false, bookmarked: true },
  { id: "4", actor: "Dan Wilson", initials: "DW", action: "reviewed", target: "PR #91: Add rate limiting middleware", description: "Approved with suggestions. Consider using a sliding window algorithm instead of fixed window for more consistent rate limiting.", timestamp: now - hour * 5, likes: 2, replies: 1, liked: false, bookmarked: false },
  { id: "5", actor: "Eve Martinez", initials: "EM", action: "commented", target: "Issue #156: Memory leak in WebSocket handler", description: "Reproduced on Node 20.11. The issue is in the event listener cleanup — we're missing removeListener calls in the disconnect handler.", timestamp: now - day - hour * 1, likes: 5, replies: 3, liked: false, bookmarked: false },
  { id: "6", actor: "Frank Lee", initials: "FL", action: "pushed", target: "main", description: "Hotfix: Patched XSS vulnerability in markdown renderer. Sanitize HTML output before DOM insertion. CVE-2024-3821.", timestamp: now - day - hour * 3, likes: 15, replies: 6, liked: true, bookmarked: true },
  { id: "7", actor: "Grace Kim", initials: "GK", action: "merged", target: "PR #87: Implement caching layer", description: "Redis caching layer for API responses. Average response time dropped from 340ms to 45ms on cached endpoints.", timestamp: now - day - hour * 6, likes: 9, replies: 2, liked: false, bookmarked: false },
  { id: "8", actor: "Henry Chen", initials: "HC", action: "reviewed", target: "PR #93: Refactor error handling", description: "Requested changes. The custom error classes should extend a base AppError class for consistent serialization across all API endpoints.", timestamp: now - day * 2 - hour * 1, likes: 1, replies: 1, liked: false, bookmarked: false },
  { id: "9", actor: "Iris Wang", initials: "IW", action: "commented", target: "Issue #160: CI pipeline timeout", description: "The timeout is caused by the E2E test suite. We should parallelize the Playwright tests across 4 workers instead of running sequentially.", timestamp: now - day * 2 - hour * 4, likes: 4, replies: 2, liked: false, bookmarked: false },
  { id: "10", actor: "Jack Brown", initials: "JB", action: "pushed", target: "feature/dark-mode", description: "Implemented CSS custom properties for theme switching. All 47 components updated with dark mode variants. Zero layout shift on toggle.", timestamp: now - day * 2 - hour * 8, likes: 11, replies: 5, liked: true, bookmarked: false },
];

function formatTimestamp(ts: number): string {
  const diff = now - ts;
  if (diff < day) return format(new Date(ts), "h:mm a");
  if (diff < day * 2) return "Yesterday " + format(new Date(ts), "h:mm a");
  return format(new Date(ts), "MMM d, h:mm a");
}

function groupByDate(activities: ActivityItem[]): Record<string, ActivityItem[]> {
  const groups: Record<string, ActivityItem[]> = {};
  activities.forEach((activity) => {
    const diff = now - activity.timestamp;
    let label: string;
    if (diff < day) label = "Today";
    else if (diff < day * 2) label = "Yesterday";
    else label = format(new Date(activity.timestamp), "MMMM d, yyyy");
    if (!groups[label]) groups[label] = [];
    groups[label].push(activity);
  });
  return groups;
}

function SkeletonItem() {
  return (
    <div className="flex gap-3 p-4">
      <Skeleton className="h-10 w-10 rounded-full shrink-0" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
}

function ActivityFeed() {
  const { items: activities, push: prepend } = useArrayState<ActivityItem>(
    "feedActivities",
    INITIAL_ACTIVITIES
  );
  const [isLoading, setIsLoading] = useAppState<boolean>("feedLoading", false);

  const items = activities || INITIAL_ACTIVITIES;
  const loading = isLoading ?? false;

  const loadMoreHandler = useHandler("loadMore");

  const handleLoadMore = () => {
    setIsLoading(true);
    // In a real app, call loadMoreHandler.execute() to fetch from backend
    setTimeout(() => {
      const newItem: ActivityItem = {
        id: String(Date.now()),
        actor: "System Bot",
        initials: "SB",
        action: "pushed",
        target: "main",
        description: "Automated dependency update: bumped 14 packages to latest patch versions. All tests passing.",
        timestamp: now - day * 3,
        likes: 0,
        replies: 0,
        liked: false,
        bookmarked: false,
      };
      prepend(newItem);
      setIsLoading(false);
    }, 1500);
  };

  const grouped = groupByDate(items);
  const groupKeys = Object.keys(grouped);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-xl">Activity Feed</CardTitle>
          <Badge variant="secondary" className="text-xs">
            {items.length} events
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[600px]">
          <div className="divide-y">
            {loading && (
              <>
                <SkeletonItem />
                <SkeletonItem />
                <SkeletonItem />
              </>
            )}
            {groupKeys.map((groupLabel, gi) => (
              <React.Fragment key={groupLabel}>
                {gi > 0 && <ItemSeparator />}
                <ItemGroup>
                  <div className="px-4 py-2 bg-muted/50">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      {groupLabel}
                    </span>
                  </div>
                  {grouped[groupLabel].map((activity: ActivityItem) => (
                    <Item key={activity.id} className="px-4 py-3 hover:bg-muted/30 transition-colors">
                      <ItemMedia>
                        <Avatar className="h-10 w-10">
                          <AvatarFallback className="text-xs font-semibold bg-primary/10 text-primary">
                            {activity.initials}
                          </AvatarFallback>
                        </Avatar>
                      </ItemMedia>
                      <ItemContent className="min-w-0 flex-1">
                        <ItemHeader>
                          <span className="text-xs text-muted-foreground">
                            {formatTimestamp(activity.timestamp)}
                          </span>
                        </ItemHeader>
                        <ItemTitle className="text-sm">
                          <span className="font-semibold">{activity.actor}</span>
                          {" "}
                          <span className="text-muted-foreground">
                            {ACTION_LABELS[activity.action]}
                          </span>
                          {" "}
                          <Badge
                            className={cn(
                              "text-xs font-normal",
                              ACTION_COLORS[activity.action]
                            )}
                          >
                            {activity.action}
                          </Badge>
                        </ItemTitle>
                        <ItemDescription className="text-sm font-medium text-foreground/80 mt-0.5">
                          {activity.target}
                        </ItemDescription>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {activity.description}
                        </p>
                        <ItemFooter className="mt-2">
                          <div className="flex items-center gap-4 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Icons.Heart className="h-3 w-3" />
                              {activity.likes}
                            </span>
                            <span className="flex items-center gap-1">
                              <Icons.MessageSquare className="h-3 w-3" />
                              {activity.replies}
                            </span>
                          </div>
                        </ItemFooter>
                      </ItemContent>
                      <ItemActions className="flex flex-col gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className={cn(
                            "h-8 w-8 p-0",
                            activity.liked && "text-red-500"
                          )}
                        >
                          <Icons.Heart
                            className={cn(
                              "h-4 w-4",
                              activity.liked && "fill-current"
                            )}
                          />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                          <Icons.MessageSquare className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className={cn(
                            "h-8 w-8 p-0",
                            activity.bookmarked && "text-yellow-500"
                          )}
                        >
                          <Icons.Bookmark
                            className={cn(
                              "h-4 w-4",
                              activity.bookmarked && "fill-current"
                            )}
                          />
                        </Button>
                      </ItemActions>
                    </Item>
                  ))}
                </ItemGroup>
              </React.Fragment>
            ))}
          </div>
          <div className="p-4 text-center">
            <Button
              variant="outline"
              onClick={handleLoadMore}
              disabled={loading}
              className="w-full"
            >
              {loading ? (
                <>
                  <Icons.Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Loading...
                </>
              ) : (
                <>
                  <Icons.ChevronDown className="mr-2 h-4 w-4" />
                  Load More
                </>
              )}
            </Button>
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

export default ActivityFeed;
