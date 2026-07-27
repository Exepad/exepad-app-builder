import {
  React,
  useModel,
  useAppState,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  Button,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Icons,
  cn,
} from "@exepad/sdk";

interface Activity {
  id: string;
  type: string;
  subject: string;
  description: string;
  contact_name: string;
  deal_name: string | null;
  date: string;
  time: string;
}

const DEMO_ACTIVITIES: Activity[] = [
  { id: "1", type: "call", subject: "Discovery call with Netflix", description: "Discussed cloud migration requirements and timeline. They need a solution by Q2.", contact_name: "Greg Peters", deal_name: "Cloud Migration", date: "2026-03-27", time: "10:30 AM" },
  { id: "2", type: "email", subject: "Proposal sent to Stripe", description: "Sent the revised API integration proposal with updated pricing tiers.", contact_name: "Patrick Collison", deal_name: "API Integration", date: "2026-03-27", time: "09:15 AM" },
  { id: "3", type: "meeting", subject: "QBR with Salesforce", description: "Quarterly business review — discussed renewal and expansion opportunities.", contact_name: "Marc Benioff", deal_name: "Enterprise License", date: "2026-03-26", time: "02:00 PM" },
  { id: "4", type: "note", subject: "Updated deal notes for Shopify", description: "Tobi mentioned they are evaluating two other vendors. Need to prepare a competitive comparison.", contact_name: "Tobi Lutke", deal_name: "Platform Upgrade", date: "2026-03-26", time: "11:45 AM" },
  { id: "5", type: "email", subject: "Follow-up on pricing discussion", description: "Sent follow-up email with custom pricing for the data analytics suite.", contact_name: "Frank Slootman", deal_name: "Data Analytics Suite", date: "2026-03-26", time: "09:00 AM" },
  { id: "6", type: "call", subject: "Security requirements deep-dive", description: "Reviewed SOC2 compliance requirements and our security posture documentation.", contact_name: "Satya Nadella", deal_name: "Security Audit", date: "2026-03-25", time: "03:30 PM" },
  { id: "7", type: "meeting", subject: "Demo presentation to NVIDIA", description: "Presented ML pipeline capabilities to Jensen and his engineering leads.", contact_name: "Jensen Huang", deal_name: "ML Pipeline", date: "2026-03-25", time: "01:00 PM" },
  { id: "8", type: "email", subject: "Contract terms review", description: "Sent updated contract with revised SLA terms for the DevOps tooling deal.", contact_name: "Andy Jassy", deal_name: "DevOps Tooling", date: "2026-03-25", time: "10:00 AM" },
  { id: "9", type: "note", subject: "Competitive intel from Apple meeting", description: "Tim mentioned they are also looking at Datadog and New Relic. Our advantage is the integrated SDK.", contact_name: "Tim Cook", deal_name: "Mobile SDK", date: "2026-03-24", time: "04:15 PM" },
  { id: "10", type: "call", subject: "Onboarding check-in with Google", description: "Platform integration is going smoothly. Sundar happy with the API performance.", contact_name: "Sundar Pichai", deal_name: "Cloud Infra Deal", date: "2026-03-24", time: "02:30 PM" },
  { id: "11", type: "meeting", subject: "Pipeline review with Airbnb", description: "Discussed travel platform requirements and integration with their existing stack.", contact_name: "Brian Chesky", deal_name: "Travel Platform", date: "2026-03-24", time: "11:00 AM" },
  { id: "12", type: "email", subject: "Welcome email to new lead", description: "Sent introductory email with product overview and case studies.", contact_name: "Doug McMillon", deal_name: null, date: "2026-03-23", time: "09:30 AM" },
  { id: "13", type: "call", subject: "Renewal discussion with Tesla", description: "Elon wants to expand the supply chain AI scope. Discussing additional modules.", contact_name: "Elon Musk", deal_name: "Supply Chain AI", date: "2026-03-23", time: "04:00 PM" },
  { id: "14", type: "note", subject: "Lost deal analysis — Meta", description: "Post-mortem on the lost deal. Main reason: budget cuts and internal tool prioritization.", contact_name: "Mark Zuckerberg", deal_name: "Social Analytics", date: "2026-03-23", time: "01:30 PM" },
  { id: "15", type: "meeting", subject: "Stakeholder alignment with Costco", description: "Met with procurement and IT leads to align on implementation timeline.", contact_name: "Ron Vachris", deal_name: "Warehouse Mgmt", date: "2026-03-22", time: "10:00 AM" },
  { id: "16", type: "email", subject: "Case study shared with Walmart", description: "Shared our Costco case study to build confidence in the e-commerce suite.", contact_name: "Doug McMillon", deal_name: "E-commerce Suite", date: "2026-03-22", time: "08:45 AM" },
  { id: "17", type: "call", subject: "Technical deep-dive with Snowflake", description: "Engineering call to discuss data warehouse integration patterns.", contact_name: "Frank Slootman", deal_name: "Data Analytics Suite", date: "2026-03-21", time: "03:00 PM" },
  { id: "18", type: "note", subject: "Budget approval pending at Netflix", description: "Greg said the CFO needs to sign off. Expected approval by end of week.", contact_name: "Greg Peters", deal_name: "Cloud Migration", date: "2026-03-21", time: "11:30 AM" },
  { id: "19", type: "meeting", subject: "Executive alignment with Stripe", description: "Patrick brought in CTO to discuss long-term API strategy.", contact_name: "Patrick Collison", deal_name: "API Integration", date: "2026-03-20", time: "02:00 PM" },
  { id: "20", type: "email", subject: "Thank you note after Salesforce QBR", description: "Sent thank you email with action items and next steps from the QBR.", contact_name: "Marc Benioff", deal_name: "Enterprise License", date: "2026-03-20", time: "09:00 AM" },
  { id: "21", type: "call", subject: "Initial outreach to Uber", description: "Cold call to explore analytics needs after their recent reorg.", contact_name: "Dara Khosrowshahi", deal_name: null, date: "2026-03-19", time: "04:30 PM" },
];

const ACTIVITY_ICONS: Record<string, keyof typeof Icons> = {
  call: "Phone",
  email: "Mail",
  meeting: "Calendar",
  note: "FileText",
};

const ACTIVITY_COLORS: Record<string, string> = {
  call: "bg-blue-500",
  email: "bg-green-500",
  meeting: "bg-purple-500",
  note: "bg-yellow-500",
};

const TYPE_BADGE_COLORS: Record<string, string> = {
  call: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  email: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  meeting: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300",
  note: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
};

function ActivityFeed() {
  const activitiesModel = useModel("activities");
  const activities = (activitiesModel?.data as any[] | null) ?? DEMO_ACTIVITIES;
  const [activeTab, setActiveTab] = React.useState("all");

  const filtered = activeTab === "all"
    ? DEMO_ACTIVITIES
    : DEMO_ACTIVITIES.filter((a) => a.type === activeTab);

  const typeCounts = DEMO_ACTIVITIES.reduce((acc, a) => {
    acc[a.type] = (acc[a.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const groupByDate = (items: Activity[]) => {
    const groups: Record<string, Activity[]> = {};
    items.forEach((item) => {
      if (!groups[item.date]) groups[item.date] = [];
      groups[item.date].push(item);
    });
    return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
  };

  const grouped = groupByDate(filtered);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr + "T00:00:00");
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (dateStr === today.toISOString().split("T")[0]) return "Today";
    if (dateStr === yesterday.toISOString().split("T")[0]) return "Yesterday";
    return date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Activity Feed</h2>
          <p className="text-sm text-muted-foreground">{DEMO_ACTIVITIES.length} activities logged</p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Icons.Plus className="h-4 w-4" />
          Log Activity
        </Button>
      </div>

      {/* Filter Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="all">All ({DEMO_ACTIVITIES.length})</TabsTrigger>
          <TabsTrigger value="call">Calls ({typeCounts.call || 0})</TabsTrigger>
          <TabsTrigger value="email">Emails ({typeCounts.email || 0})</TabsTrigger>
          <TabsTrigger value="meeting">Meetings ({typeCounts.meeting || 0})</TabsTrigger>
          <TabsTrigger value="note">Notes ({typeCounts.note || 0})</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Timeline */}
      <div className="space-y-8">
        {grouped.map(([date, items]) => (
          <div key={date}>
            <h3 className="text-sm font-semibold text-muted-foreground mb-4">{formatDate(date)}</h3>
            <div className="space-y-1">
              {items.map((activity, idx) => {
                const ActIcon = Icons[ACTIVITY_ICONS[activity.type]] as React.ComponentType<{ className?: string }>;
                const isLast = idx === items.length - 1;

                return (
                  <div key={activity.id} className="flex gap-4">
                    {/* Timeline dot + line */}
                    <div className="flex flex-col items-center">
                      <div className={cn("activity-dot shrink-0", ACTIVITY_COLORS[activity.type])} />
                      {!isLast && <div className="w-px flex-1 bg-border mt-1" />}
                    </div>

                    {/* Content */}
                    <Card className="flex-1 mb-3">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-3 flex-1">
                            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                              {ActIcon && <ActIcon className="h-4 w-4 text-muted-foreground" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-sm font-medium">{activity.subject}</span>
                                <Badge className={cn("text-[10px] px-1.5", TYPE_BADGE_COLORS[activity.type])}>
                                  {activity.type}
                                </Badge>
                              </div>
                              <p className="text-sm text-muted-foreground">{activity.description}</p>
                              <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                                <div className="flex items-center gap-1">
                                  <Icons.User className="h-3 w-3" />
                                  <span>{activity.contact_name}</span>
                                </div>
                                {activity.deal_name && (
                                  <div className="flex items-center gap-1">
                                    <Icons.Briefcase className="h-3 w-3" />
                                    <span>{activity.deal_name}</span>
                                  </div>
                                )}
                                <span>{activity.time}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default ActivityFeed;
