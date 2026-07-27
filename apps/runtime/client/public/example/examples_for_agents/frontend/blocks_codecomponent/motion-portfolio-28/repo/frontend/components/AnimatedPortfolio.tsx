import {
  React,
  useAppState,
  Motion,
  motion,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  ToggleGroup,
  ToggleGroupItem,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Icons,
  cn,
} from "@exepad/sdk";

interface Project {
  id: string;
  title: string;
  category: "web" | "mobile" | "design";
  description: string;
  color: string;
  tags: string[];
}

const PROJECTS: Project[] = [
  { id: "p1", title: "E-Commerce Platform", category: "web", description: "Full-stack online store with real-time inventory tracking, payment processing, and admin dashboard.", color: "bg-fuchsia-500", tags: ["React", "Node.js", "Stripe"] },
  { id: "p2", title: "Fitness Tracker App", category: "mobile", description: "Cross-platform mobile app for workout logging, progress photos, and social challenges.", color: "bg-violet-500", tags: ["React Native", "Firebase"] },
  { id: "p3", title: "Brand Identity System", category: "design", description: "Complete brand kit including logo, color palette, typography, and usage guidelines.", color: "bg-pink-500", tags: ["Figma", "Illustrator"] },
  { id: "p4", title: "Analytics Dashboard", category: "web", description: "Real-time data visualization dashboard with customizable widgets and export capabilities.", color: "bg-fuchsia-600", tags: ["Next.js", "D3.js", "PostgreSQL"] },
  { id: "p5", title: "Food Delivery App", category: "mobile", description: "Location-based food ordering app with live driver tracking and restaurant management portal.", color: "bg-purple-500", tags: ["Flutter", "Google Maps"] },
  { id: "p6", title: "SaaS Landing Page", category: "design", description: "High-conversion landing page design with A/B test variants and micro-interactions.", color: "bg-rose-500", tags: ["Figma", "Framer"] },
  { id: "p7", title: "Project Management Tool", category: "web", description: "Kanban-style project tracker with team collaboration, file sharing, and time tracking.", color: "bg-fuchsia-400", tags: ["Vue.js", "Supabase"] },
  { id: "p8", title: "Meditation App", category: "mobile", description: "Guided meditation and breathing exercises with ambient sounds and streak tracking.", color: "bg-indigo-500", tags: ["Swift", "HealthKit"] },
  { id: "p9", title: "Design System", category: "design", description: "Comprehensive component library with tokens, patterns, and accessibility documentation.", color: "bg-fuchsia-700", tags: ["Storybook", "Tokens"] },
];

const CATEGORIES = [
  { value: "all", label: "All" },
  { value: "web", label: "Web" },
  { value: "mobile", label: "Mobile" },
  { value: "design", label: "Design" },
];

const CATEGORY_ICONS: Record<string, keyof typeof Icons> = {
  web: "Globe",
  mobile: "Smartphone",
  design: "Paintbrush",
};

function AnimatedPortfolio() {
  const [filter, setFilter] = useAppState<string>("portfolioFilter", "all");
  const [selectedId, setSelectedId] = useAppState<string | null>("selectedProject", null);
  const [mousePos, setMousePos] = React.useState({ x: 0, y: 0 });

  const activeFilter = filter ?? "all";
  const filtered = activeFilter === "all"
    ? PROJECTS
    : PROJECTS.filter((p) => p.category === activeFilter);

  const selectedProject = PROJECTS.find((p) => p.id === selectedId);

  const handleMouseMove = React.useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      setMousePos({
        x: (e.clientX - rect.left - rect.width / 2) / 40,
        y: (e.clientY - rect.top - rect.height / 2) / 40,
      });
    },
    []
  );

  return (
    <div className="space-y-8">
      {/* Hero section with parallax mouse tracking */}
      <Motion.div
        className="relative overflow-hidden rounded-xl bg-gradient-to-br from-fuchsia-500/10 via-purple-500/10 to-pink-500/10 p-8 md:p-12"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setMousePos({ x: 0, y: 0 })}
      >
        <Motion.div
          animate={{ x: mousePos.x * 2, y: mousePos.y * 2 }}
          transition={{ type: "spring", stiffness: 150, damping: 15 }}
        >
          <h2 className="text-3xl md:text-4xl font-bold mb-2">
            Creative Portfolio
          </h2>
          <p className="text-muted-foreground text-lg max-w-xl">
            A collection of projects spanning web development, mobile apps, and design systems.
          </p>
          <div className="flex gap-2 mt-4">
            <Badge>9 Projects</Badge>
            <Badge variant="secondary">3 Categories</Badge>
          </div>
        </Motion.div>
        <Motion.div
          className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-fuchsia-500/20 blur-3xl"
          animate={{ x: -mousePos.x * 3, y: -mousePos.y * 3 }}
          transition={{ type: "spring", stiffness: 100, damping: 20 }}
        />
      </Motion.div>

      {/* Category Filter */}
      <div className="flex justify-center">
        <ToggleGroup
          type="single"
          value={activeFilter}
          onValueChange={(val: string) => {
            if (val) setFilter(val);
          }}
        >
          {CATEGORIES.map((cat) => (
            <ToggleGroupItem key={cat.value} value={cat.value} className="px-4">
              {cat.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {/* Project Grid */}
      <motion.div layout className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {filtered.map((project, index) => {
          const CatIcon = Icons[CATEGORY_ICONS[project.category] ?? "Folder"] as React.ComponentType<{ className?: string }>;

          return (
            <Motion.div
              key={project.id}
              layout
              layoutId={project.id}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.35, delay: index * 0.06 }}
              whileHover={{ scale: 1.03, y: -5 }}
              whileTap={{ scale: 0.97 }}
              className="cursor-pointer"
              onClick={() => setSelectedId(project.id)}
            >
              <Card className="h-full overflow-hidden transition-shadow hover:shadow-lg">
                <div className={cn("h-32 w-full flex items-center justify-center", project.color)}>
                  {CatIcon && (
                    <CatIcon className="h-10 w-10 text-white/80" />
                  )}
                </div>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{project.title}</CardTitle>
                    <Badge variant="outline" className="text-xs capitalize">
                      {project.category}
                    </Badge>
                  </div>
                  <CardDescription className="line-clamp-2">
                    {project.description}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-1">
                    {project.tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </Motion.div>
          );
        })}
      </motion.div>

      {filtered.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <Icons.FolderOpen className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <p>No projects found in this category.</p>
        </div>
      )}

      {/* Detail Dialog */}
      <Dialog
        open={!!selectedId}
        onOpenChange={(open: boolean) => {
          if (!open) setSelectedId(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          {selectedProject && (
            <>
              <div className={cn("h-40 w-full rounded-lg flex items-center justify-center mb-4", selectedProject.color)}>
                {(() => {
                  const DIcon = Icons[CATEGORY_ICONS[selectedProject.category] ?? "Folder"] as React.ComponentType<{ className?: string }>;
                  return DIcon ? <DIcon className="h-14 w-14 text-white/80" /> : null;
                })()}
              </div>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {selectedProject.title}
                  <Badge variant="outline" className="capitalize">
                    {selectedProject.category}
                  </Badge>
                </DialogTitle>
                <DialogDescription>
                  {selectedProject.description}
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-wrap gap-2 mt-4">
                {selectedProject.tags.map((tag) => (
                  <Badge key={tag} variant="secondary">
                    {tag}
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2 mt-6">
                <Button className="flex-1">
                  <Icons.ExternalLink className="mr-2 h-4 w-4" />
                  View Project
                </Button>
                <Button variant="outline" className="flex-1">
                  <Icons.Github className="mr-2 h-4 w-4" />
                  Source Code
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default AnimatedPortfolio;
