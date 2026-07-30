import {
  React,
  useModel,
  useAppState,
  toast,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  Button,
  ScrollArea,
  Icons,
  cn,
} from "@exepad/sdk";

interface Deal {
  id: string;
  name: string;
  company: string;
  value: number;
  stage: string;
  close_date: string;
  contact_name: string;
}

const DEMO_DEALS: Deal[] = [
  { id: "1", name: "Enterprise License", company: "Salesforce", value: 185000, stage: "negotiation", close_date: "2026-04-15", contact_name: "Marc Benioff" },
  { id: "2", name: "Cloud Migration", company: "Netflix", value: 142000, stage: "proposal", close_date: "2026-05-01", contact_name: "Greg Peters" },
  { id: "3", name: "API Integration", company: "Stripe", value: 128000, stage: "negotiation", close_date: "2026-04-20", contact_name: "Patrick Collison" },
  { id: "4", name: "Platform Upgrade", company: "Shopify", value: 115000, stage: "qualification", close_date: "2026-06-01", contact_name: "Tobi Lutke" },
  { id: "5", name: "Data Analytics Suite", company: "Snowflake", value: 98000, stage: "proposal", close_date: "2026-05-15", contact_name: "Frank Slootman" },
  { id: "6", name: "Security Audit", company: "Microsoft", value: 76000, stage: "qualification", close_date: "2026-06-10", contact_name: "Satya Nadella" },
  { id: "7", name: "ML Pipeline", company: "NVIDIA", value: 210000, stage: "proposal", close_date: "2026-05-20", contact_name: "Jensen Huang" },
  { id: "8", name: "DevOps Tooling", company: "Amazon", value: 165000, stage: "qualification", close_date: "2026-07-01", contact_name: "Andy Jassy" },
  { id: "9", name: "Mobile SDK", company: "Apple", value: 92000, stage: "closed_won", close_date: "2026-03-15", contact_name: "Tim Cook" },
  { id: "10", name: "Ride Analytics", company: "Uber", value: 55000, stage: "closed_lost", close_date: "2026-02-28", contact_name: "Dara Khosrowshahi" },
  { id: "11", name: "Travel Platform", company: "Airbnb", value: 88000, stage: "qualification", close_date: "2026-06-15", contact_name: "Brian Chesky" },
  { id: "12", name: "Cloud Infra Deal", company: "Google", value: 195000, stage: "negotiation", close_date: "2026-04-30", contact_name: "Sundar Pichai" },
  { id: "13", name: "Warehouse Mgmt", company: "Costco", value: 67000, stage: "proposal", close_date: "2026-05-25", contact_name: "Ron Vachris" },
  { id: "14", name: "Supply Chain AI", company: "Tesla", value: 230000, stage: "closed_won", close_date: "2026-03-10", contact_name: "Elon Musk" },
  { id: "15", name: "E-commerce Suite", company: "Walmart", value: 145000, stage: "closed_won", close_date: "2026-03-20", contact_name: "Doug McMillon" },
  { id: "16", name: "Social Analytics", company: "Meta", value: 110000, stage: "closed_lost", close_date: "2026-02-15", contact_name: "Mark Zuckerberg" },
];

interface StageConfig {
  key: string;
  label: string;
  color: string;
  bgColor: string;
}

const STAGES: StageConfig[] = [
  { key: "qualification", label: "Qualification", color: "text-blue-600 dark:text-blue-400", bgColor: "bg-blue-500" },
  { key: "proposal", label: "Proposal", color: "text-yellow-600 dark:text-yellow-400", bgColor: "bg-yellow-500" },
  { key: "negotiation", label: "Negotiation", color: "text-purple-600 dark:text-purple-400", bgColor: "bg-purple-500" },
  { key: "closed_won", label: "Closed Won", color: "text-green-600 dark:text-green-400", bgColor: "bg-green-500" },
  { key: "closed_lost", label: "Closed Lost", color: "text-red-600 dark:text-red-400", bgColor: "bg-red-500" },
];

function formatCurrency(value: number): string {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
  return `$${value}`;
}

function DealsPipeline() {
  const dealsModel = useModel("deals");
  const deals = (dealsModel?.data as any[] | null) ?? DEMO_DEALS;
  const [pipelineFilter] = useAppState<string>("pipelineFilter", "all");

  const handleDealClick = (deal: Deal) => {
    toast(`Viewing deal: ${deal.name} — ${formatCurrency(deal.value)}`);
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Deal Pipeline</h2>
          <p className="text-sm text-muted-foreground">
            {DEMO_DEALS.length} deals &middot; {formatCurrency(DEMO_DEALS.reduce((s, d) => s + d.value, 0))} total value
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Icons.Plus className="h-4 w-4" />
          New Deal
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {STAGES.map((stage) => {
          const stageDeals = DEMO_DEALS.filter((d) => d.stage === stage.key);
          const totalValue = stageDeals.reduce((sum, d) => sum + d.value, 0);

          return (
            <div key={stage.key} className="flex flex-col">
              {/* Column Header */}
              <div className="flex items-center justify-between mb-3 px-1">
                <div className="flex items-center gap-2">
                  <div className={cn("h-2 w-2 rounded-full", stage.bgColor)} />
                  <span className={cn("text-sm font-semibold", stage.color)}>{stage.label}</span>
                  <Badge variant="secondary" className="text-[10px] px-1.5">{stageDeals.length}</Badge>
                </div>
              </div>
              <div className="text-xs text-muted-foreground mb-2 px-1">
                {formatCurrency(totalValue)}
              </div>

              {/* Deal Cards */}
              <div className="pipeline-column space-y-2">
                {stageDeals.map((deal) => (
                  <Card
                    key={deal.id}
                    className="deal-card cursor-pointer hover:shadow-md transition-shadow"
                    onClick={() => handleDealClick(deal)}
                  >
                    <CardContent className="p-3 space-y-2">
                      <div>
                        <p className="text-sm font-medium leading-tight">{deal.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{deal.company}</p>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold text-primary">
                          {formatCurrency(deal.value)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Icons.User className="h-3 w-3" />
                          <span className="truncate max-w-[80px]">{deal.contact_name}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Icons.Calendar className="h-3 w-3" />
                          <span>{deal.close_date.slice(5)}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
                {stageDeals.length === 0 && (
                  <div className="flex items-center justify-center h-24 border border-dashed border-border rounded-lg">
                    <p className="text-xs text-muted-foreground">No deals</p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default DealsPipeline;
