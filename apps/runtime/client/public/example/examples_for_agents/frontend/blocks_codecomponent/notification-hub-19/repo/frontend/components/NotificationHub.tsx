import {
  React,
  useArrayState,
  useAppState,
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
  DrawerClose,
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
  Button,
  Badge,
  Avatar,
  AvatarFallback,
  Separator,
  ScrollArea,
  Card,
  CardContent,
  Icons,
  cn,
} from "@exepad/sdk";

interface Notification {
  id: string;
  avatar: string;
  initials: string;
  title: string;
  message: string;
  detail: string;
  timestamp: string;
  read: boolean;
  category: string;
}

const INITIAL_NOTIFICATIONS: Notification[] = [
  {
    id: "1",
    avatar: "",
    initials: "AM",
    title: "Alice Morgan",
    message: "Commented on your pull request #42",
    detail: "Great work on the refactor! I left a few suggestions on the utility module. The approach to caching looks solid overall.",
    timestamp: "2 min ago",
    read: false,
    category: "code-review",
  },
  {
    id: "2",
    avatar: "",
    initials: "SB",
    title: "System Bot",
    message: "Deployment to production completed",
    detail: "Build v2.4.1 was successfully deployed to production at 14:32 UTC. All health checks passed. 0 errors in the last 5 minutes.",
    timestamp: "15 min ago",
    read: false,
    category: "deployment",
  },
  {
    id: "3",
    avatar: "",
    initials: "JK",
    title: "James Kim",
    message: "Invited you to workspace 'Design System'",
    detail: "James has invited you as an Editor to the Design System workspace. You will have access to all shared components and documentation.",
    timestamp: "1 hour ago",
    read: false,
    category: "invitation",
  },
  {
    id: "4",
    avatar: "",
    initials: "LR",
    title: "Luna Rivera",
    message: "Mentioned you in a comment on Task-128",
    detail: "Hey, could you take a look at the API schema changes? I think we need your input on the pagination approach before we proceed.",
    timestamp: "3 hours ago",
    read: true,
    category: "mention",
  },
  {
    id: "5",
    avatar: "",
    initials: "SB",
    title: "System Bot",
    message: "Your storage usage is at 85%",
    detail: "You are currently using 8.5 GB of your 10 GB storage allocation. Consider archiving old files or upgrading your plan.",
    timestamp: "1 day ago",
    read: true,
    category: "system",
  },
];

const CATEGORY_ICONS: Record<string, string> = {
  "code-review": "text-blue-500",
  deployment: "text-green-500",
  invitation: "text-purple-500",
  mention: "text-orange-500",
  system: "text-gray-500",
};

function NotificationItem({
  notification,
  onMarkRead,
  onRemove,
}: {
  notification: Notification;
  onMarkRead: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <div
          className={cn(
            "flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors",
            notification.read
              ? "bg-transparent hover:bg-muted/50"
              : "bg-primary/5 hover:bg-primary/10"
          )}
        >
          <Avatar className="h-9 w-9 shrink-0">
            <AvatarFallback
              className={cn(
                "text-xs font-medium",
                CATEGORY_ICONS[notification.category] || "text-gray-500"
              )}
            >
              {notification.initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium truncate">
                {notification.title}
              </span>
              {!notification.read && (
                <Badge variant="default" className="h-5 text-[10px] px-1.5 shrink-0">
                  New
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {notification.message}
            </p>
            <span className="text-[11px] text-muted-foreground/70 mt-1 block">
              {notification.timestamp}
            </span>
          </div>
          <div className="flex flex-col gap-1 shrink-0">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={(e: React.MouseEvent) => {
                      e.stopPropagation();
                      onMarkRead(notification.id);
                    }}
                  >
                    <Icons.Check className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left">
                  <p>Mark as read</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-destructive"
                    onClick={(e: React.MouseEvent) => {
                      e.stopPropagation();
                      onRemove(notification.id);
                    }}
                  >
                    <Icons.X className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left">
                  <p>Dismiss</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </HoverCardTrigger>
      <HoverCardContent side="left" className="w-80">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="text-xs">
                {notification.initials}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="text-sm font-semibold">{notification.title}</p>
              <p className="text-xs text-muted-foreground">
                {notification.timestamp}
              </p>
            </div>
          </div>
          <Separator />
          <p className="text-sm text-muted-foreground leading-relaxed">
            {notification.detail}
          </p>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {notification.category}
            </Badge>
            {!notification.read && (
              <Badge variant="secondary" className="text-xs">
                Unread
              </Badge>
            )}
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

function NotificationHub() {
  const { items: notifications, set: setNotifications } = useArrayState<Notification>(
    "hubNotifications",
    INITIAL_NOTIFICATIONS
  );
  const [sheetOpen, setSheetOpen] = useAppState<boolean>("sheetOpen", false);
  const [drawerOpen, setDrawerOpen] = useAppState<boolean>("drawerOpen", false);

  const items = notifications ?? INITIAL_NOTIFICATIONS;
  const unreadCount = items.filter((n: Notification) => !n.read).length;

  const handleMarkRead = (id: string) => {
    setNotifications(
      items.map((n: Notification) =>
        n.id === id ? { ...n, read: true } : n
      )
    );
  };

  const handleRemove = (id: string) => {
    setNotifications(items.filter((n: Notification) => n.id !== id));
  };

  const handleMarkAllRead = () => {
    setNotifications(
      items.map((n: Notification) => ({ ...n, read: true }))
    );
  };

  const groupedByCategory = items.reduce(
    (acc: Record<string, Notification[]>, n: Notification) => {
      const cat = n.category;
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(n);
      return acc;
    },
    {} as Record<string, Notification[]>
  );

  return (
    <div className="max-w-md mx-auto space-y-6">
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold">Notifications</h2>
              <p className="text-sm text-muted-foreground">
                You have {unreadCount} unread notification{unreadCount !== 1 ? "s" : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {/* Sheet trigger - slides from right */}
              <Sheet open={sheetOpen ?? false} onOpenChange={setSheetOpen}>
                <SheetTrigger asChild>
                  <Button variant="outline" size="icon" className="relative">
                    <Icons.Bell className="h-5 w-5" />
                    {unreadCount > 0 && (
                      <Badge
                        variant="destructive"
                        className="absolute -top-2 -right-2 h-5 min-w-[20px] flex items-center justify-center text-[10px] px-1 rounded-full"
                      >
                        {unreadCount}
                      </Badge>
                    )}
                  </Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-[400px] sm:w-[440px] flex flex-col">
                  <SheetHeader>
                    <SheetTitle className="flex items-center gap-2">
                      <Icons.Bell className="h-5 w-5" />
                      Notifications
                      {unreadCount > 0 && (
                        <Badge variant="secondary">{unreadCount} new</Badge>
                      )}
                    </SheetTitle>
                    <SheetDescription>
                      Review and manage your recent notifications.
                    </SheetDescription>
                  </SheetHeader>
                  <Separator className="my-2" />
                  <ScrollArea className="flex-1 -mx-2 px-2">
                    <div className="space-y-1 py-2">
                      {items.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground">
                          <Icons.BellOff className="h-10 w-10 mx-auto mb-3 opacity-40" />
                          <p className="text-sm">No notifications</p>
                        </div>
                      ) : (
                        items.map((n: Notification) => (
                          <NotificationItem
                            key={n.id}
                            notification={n}
                            onMarkRead={handleMarkRead}
                            onRemove={handleRemove}
                          />
                        ))
                      )}
                    </div>
                  </ScrollArea>
                  <Separator className="my-2" />
                  <SheetFooter className="flex-row gap-2 sm:justify-between">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleMarkAllRead}
                      disabled={unreadCount === 0}
                    >
                      <Icons.CheckCheck className="mr-2 h-4 w-4" />
                      Mark all read
                    </Button>
                    <SheetClose asChild>
                      <Button variant="ghost" size="sm">
                        Close
                      </Button>
                    </SheetClose>
                  </SheetFooter>
                </SheetContent>
              </Sheet>

              {/* Drawer trigger - slides from bottom */}
              <Drawer open={drawerOpen ?? false} onOpenChange={setDrawerOpen}>
                <DrawerTrigger asChild>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="outline" size="icon">
                          <Icons.Layers className="h-5 w-5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Grouped view</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </DrawerTrigger>
                <DrawerContent>
                  <DrawerHeader>
                    <DrawerTitle>Notifications by Category</DrawerTitle>
                    <DrawerDescription>
                      {Object.keys(groupedByCategory).length} categories with{" "}
                      {items.length} total notifications
                    </DrawerDescription>
                  </DrawerHeader>
                  <div className="px-4 pb-4 space-y-4 max-h-[50vh] overflow-y-auto">
                    {Object.entries(groupedByCategory).map(
                      ([category, catNotifs]) => (
                        <div key={category}>
                          <div className="flex items-center gap-2 mb-2">
                            <Badge variant="outline" className="capitalize text-xs">
                              {category.replace("-", " ")}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {(catNotifs as Notification[]).length} notification
                              {(catNotifs as Notification[]).length !== 1 ? "s" : ""}
                            </span>
                          </div>
                          <div className="space-y-2">
                            {(catNotifs as Notification[]).map(
                              (n: Notification) => (
                                <div
                                  key={n.id}
                                  className={cn(
                                    "flex items-center gap-3 p-2 rounded-md text-sm",
                                    n.read ? "opacity-60" : "bg-primary/5"
                                  )}
                                >
                                  <Avatar className="h-7 w-7">
                                    <AvatarFallback className="text-[10px]">
                                      {n.initials}
                                    </AvatarFallback>
                                  </Avatar>
                                  <div className="flex-1 min-w-0">
                                    <p className="font-medium truncate text-xs">
                                      {n.title}
                                    </p>
                                    <p className="text-xs text-muted-foreground truncate">
                                      {n.message}
                                    </p>
                                  </div>
                                  <span className="text-[10px] text-muted-foreground/70 shrink-0">
                                    {n.timestamp}
                                  </span>
                                </div>
                              )
                            )}
                          </div>
                          <Separator className="mt-3" />
                        </div>
                      )
                    )}
                  </div>
                  <DrawerFooter>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleMarkAllRead}
                      disabled={unreadCount === 0}
                    >
                      <Icons.CheckCheck className="mr-2 h-4 w-4" />
                      Mark all read
                    </Button>
                    <DrawerClose asChild>
                      <Button variant="ghost" size="sm">
                        Close
                      </Button>
                    </DrawerClose>
                  </DrawerFooter>
                </DrawerContent>
              </Drawer>
            </div>
          </div>

          {/* Inline preview of latest 3 */}
          <div className="space-y-1">
            {items.slice(0, 3).map((n: Notification) => (
              <div
                key={n.id}
                className={cn(
                  "flex items-center gap-3 p-2 rounded-md transition-colors",
                  n.read ? "hover:bg-muted/50" : "bg-primary/5 hover:bg-primary/10"
                )}
              >
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="text-xs">{n.initials}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{n.message}</p>
                  <p className="text-xs text-muted-foreground">{n.timestamp}</p>
                </div>
                {!n.read && (
                  <span className="h-2 w-2 rounded-full bg-primary shrink-0" />
                )}
              </div>
            ))}
          </div>

          {items.length > 3 && (
            <Button
              variant="link"
              className="w-full mt-2 text-xs"
              onClick={() => setSheetOpen(true)}
            >
              View all {items.length} notifications
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default NotificationHub;
