import {
  React,
  Charts,
  ChartContainer,
  ChartConfig,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  Avatar,
  AvatarImage,
  AvatarFallback,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  useAppState,
  cn,
} from "@exepad/sdk";

interface TeamMember {
  id: string;
  name: string;
  role: string;
  avatar: string;
  initials: string;
  skills: {
    frontend: number;
    backend: number;
    devops: number;
    design: number;
    communication: number;
    leadership: number;
  };
  tasks: {
    design: number;
    development: number;
    testing: number;
    devops: number;
    research: number;
  };
}

const TEAM_MEMBERS: TeamMember[] = [
  {
    id: "all",
    name: "All Members",
    role: "Team Overview",
    avatar: "",
    initials: "AL",
    skills: { frontend: 78, backend: 72, devops: 65, design: 70, communication: 80, leadership: 75 },
    tasks: { design: 24, development: 45, testing: 18, devops: 12, research: 8 },
  },
  {
    id: "sarah",
    name: "Sarah Chen",
    role: "Lead Developer",
    avatar: "",
    initials: "SC",
    skills: { frontend: 92, backend: 85, devops: 70, design: 60, communication: 88, leadership: 90 },
    tasks: { design: 3, development: 18, testing: 4, devops: 2, research: 3 },
  },
  {
    id: "marcus",
    name: "Marcus Johnson",
    role: "Full Stack Developer",
    avatar: "",
    initials: "MJ",
    skills: { frontend: 80, backend: 88, devops: 75, design: 45, communication: 70, leadership: 60 },
    tasks: { design: 2, development: 15, testing: 5, devops: 6, research: 1 },
  },
  {
    id: "elena",
    name: "Elena Rodriguez",
    role: "UI/UX Designer",
    avatar: "",
    initials: "ER",
    skills: { frontend: 70, backend: 30, devops: 20, design: 95, communication: 85, leadership: 65 },
    tasks: { design: 14, development: 4, testing: 3, devops: 0, research: 2 },
  },
  {
    id: "james",
    name: "James Park",
    role: "DevOps Engineer",
    avatar: "",
    initials: "JP",
    skills: { frontend: 45, backend: 70, devops: 95, design: 25, communication: 72, leadership: 55 },
    tasks: { design: 1, development: 5, testing: 4, devops: 10, research: 2 },
  },
  {
    id: "aisha",
    name: "Aisha Patel",
    role: "QA Engineer",
    avatar: "",
    initials: "AP",
    skills: { frontend: 60, backend: 55, devops: 40, design: 50, communication: 82, leadership: 70 },
    tasks: { design: 4, development: 3, testing: 12, devops: 1, research: 3 },
  },
];

const TASK_COLORS = ["#14b8a6", "#6366f1", "#f59e0b", "#ef4444", "#8b5cf6"];

const TASK_CHART_CONFIG: ChartConfig = {
  design: { label: "Design", color: "#14b8a6" },
  development: { label: "Development", color: "#6366f1" },
  testing: { label: "Testing", color: "#f59e0b" },
  devops: { label: "DevOps", color: "#ef4444" },
  research: { label: "Research", color: "#8b5cf6" },
};

const SKILL_CHART_CONFIG: ChartConfig = {
  skills: { label: "Skill Level", color: "hsl(var(--primary))" },
};

function TeamPerformance() {
  const [selectedMember, setSelectedMember] = useAppState<string>("selectedTeamMember", "all");

  const handleMemberChange = React.useCallback((val: string) => {
    if (typeof setSelectedMember === "function") {
      setSelectedMember(val);
    }
  }, [setSelectedMember]);

  const member = TEAM_MEMBERS.find((m) => m.id === (selectedMember || "all")) || TEAM_MEMBERS[0];

  const pieData = [
    { name: "Design", value: member.tasks.design, fill: "#14b8a6" },
    { name: "Development", value: member.tasks.development, fill: "#6366f1" },
    { name: "Testing", value: member.tasks.testing, fill: "#f59e0b" },
    { name: "DevOps", value: member.tasks.devops, fill: "#ef4444" },
    { name: "Research", value: member.tasks.research, fill: "#8b5cf6" },
  ].filter((d) => d.value > 0);

  const radarData = [
    { skill: "Frontend", value: member.skills.frontend },
    { skill: "Backend", value: member.skills.backend },
    { skill: "DevOps", value: member.skills.devops },
    { skill: "Design", value: member.skills.design },
    { skill: "Communication", value: member.skills.communication },
    { skill: "Leadership", value: member.skills.leadership },
  ];

  const totalTasks = Object.values(member.tasks).reduce((sum, val) => sum + val, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Avatar className="h-10 w-10">
            {member.avatar && <AvatarImage src={member.avatar} alt={member.name} />}
            <AvatarFallback>{member.initials}</AvatarFallback>
          </Avatar>
          <div>
            <h2 className="text-xl font-bold">{member.name}</h2>
            <p className="text-sm text-muted-foreground">{member.role}</p>
          </div>
        </div>
        <Select
          value={selectedMember || "all"}
          onValueChange={handleMemberChange}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Select member" />
          </SelectTrigger>
          <SelectContent>
            {TEAM_MEMBERS.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Task Distribution</CardTitle>
            <CardDescription>
              {totalTasks} total tasks across {pieData.length} categories
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={TASK_CHART_CONFIG} className="mx-auto aspect-square max-h-[320px]">
              <Charts.PieChart>
                <ChartTooltip content={<ChartTooltipContent />} />
                <Charts.Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  strokeWidth={2}
                >
                  {pieData.map((entry, index) => (
                    <Charts.Cell key={entry.name} fill={entry.fill} />
                  ))}
                </Charts.Pie>
                <ChartLegend content={<ChartLegendContent />} />
              </Charts.PieChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Skill Assessment</CardTitle>
            <CardDescription>
              Proficiency levels across six core competencies
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={SKILL_CHART_CONFIG} className="mx-auto aspect-square max-h-[320px]">
              <Charts.RadarChart data={radarData} cx="50%" cy="50%" outerRadius="70%">
                <Charts.PolarGrid />
                <Charts.PolarAngleAxis dataKey="skill" className="text-xs" />
                <Charts.PolarRadiusAxis
                  angle={30}
                  domain={[0, 100]}
                  tick={{ fontSize: 10 }}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Charts.Radar
                  name="Skill Level"
                  dataKey="value"
                  stroke="hsl(var(--primary))"
                  fill="hsl(var(--primary))"
                  fillOpacity={0.2}
                  strokeWidth={2}
                />
              </Charts.RadarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Team Members</CardTitle>
          <CardDescription>Click a member to view their individual performance</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {TEAM_MEMBERS.filter((m) => m.id !== "all").map((m) => {
              const mTotal = Object.values(m.tasks).reduce((sum, val) => sum + val, 0);
              const isSelected = (selectedMember || "all") === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => handleMemberChange(m.id)}
                  className={cn(
                    "flex flex-col items-center gap-2 p-4 rounded-lg border transition-colors text-center",
                    isSelected
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50"
                  )}
                >
                  <Avatar className="h-12 w-12">
                    <AvatarFallback>{m.initials}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm font-medium">{m.name}</p>
                    <p className="text-xs text-muted-foreground">{m.role}</p>
                    <p className="text-xs text-muted-foreground mt-1">{mTotal} tasks</p>
                  </div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default TeamPerformance;
