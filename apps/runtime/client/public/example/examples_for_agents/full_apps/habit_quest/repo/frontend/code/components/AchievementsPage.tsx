import {
  React,
  useModel,
  useAppState,
  Icons,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Badge,
  cn,
} from "@exepad/sdk";

const DEMO_ACHIEVEMENTS = [
  { id: "a1", name: "First Step", description: "Complete your very first habit", icon: "Footprints", xp_required: 10, badge_type: "bronze" },
  { id: "a2", name: "Streak Starter", description: "Maintain a 3-day streak", icon: "Flame", xp_required: 50, badge_type: "bronze" },
  { id: "a3", name: "Week Warrior", description: "Maintain a 7-day streak without missing a day", icon: "Shield", xp_required: 150, badge_type: "silver" },
  { id: "a4", name: "Century Club", description: "Earn a total of 100 XP across all habits", icon: "Star", xp_required: 100, badge_type: "silver" },
  { id: "a5", name: "Habit Master", description: "Complete 50 total habit check-ins", icon: "Crown", xp_required: 500, badge_type: "gold" },
  { id: "a6", name: "XP Hunter", description: "Accumulate 1,000 XP points", icon: "Zap", xp_required: 1000, badge_type: "gold" },
  { id: "a7", name: "Consistency King", description: "Maintain a 30-day streak", icon: "Trophy", xp_required: 2000, badge_type: "platinum" },
  { id: "a8", name: "Legendary", description: "Reach Level 10 and unlock all other achievements", icon: "Gem", xp_required: 5000, badge_type: "platinum" },
];

const BADGE_COLORS: Record<string, { border: string; bg: string; text: string; glow: string }> = {
  bronze: { border: "border-amber-400", bg: "bg-amber-50", text: "text-amber-700", glow: "shadow-amber-200" },
  silver: { border: "border-gray-400", bg: "bg-gray-50", text: "text-gray-600", glow: "shadow-gray-200" },
  gold: { border: "border-yellow-400", bg: "bg-yellow-50", text: "text-yellow-700", glow: "shadow-yellow-200" },
  platinum: { border: "border-violet-400", bg: "bg-violet-50", text: "text-violet-700", glow: "shadow-violet-200" },
};

function AchievementsPage({ className }: { className?: string }) {
  const [totalXp] = useAppState<number>("totalXp", 280);
  const achievementsResult = useModel("achievements");
  const achievements = achievementsResult?.data ?? DEMO_ACHIEVEMENTS;

  const tierCounts = { bronze: 0, silver: 0, gold: 0, platinum: 0 };
  let unlockedCount = 0;
  (achievements || DEMO_ACHIEVEMENTS).forEach((a: any) => {
    if (totalXp >= a.xp_required) {
      unlockedCount++;
      if (tierCounts[a.badge_type as keyof typeof tierCounts] !== undefined) {
        tierCounts[a.badge_type as keyof typeof tierCounts]++;
      }
    }
  });

  return (
    <div className={cn("p-6 space-y-6", className)}>
      {/* Title */}
      <div>
        <h2 className="text-2xl font-bold text-foreground tracking-tight">Achievements</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Earn badges by completing milestones and building streaks
        </p>
      </div>

      {/* Summary */}
      <div className="flex flex-wrap gap-3">
        <Badge variant="secondary" className="text-sm px-3 py-1 bg-accent">
          <Icons.Trophy className="h-3.5 w-3.5 mr-1.5" />
          {unlockedCount}/{(achievements || DEMO_ACHIEVEMENTS).length} Unlocked
        </Badge>
        <Badge variant="secondary" className="text-sm px-3 py-1 badge-bronze">
          {tierCounts.bronze} Bronze
        </Badge>
        <Badge variant="secondary" className="text-sm px-3 py-1 badge-silver">
          {tierCounts.silver} Silver
        </Badge>
        <Badge variant="secondary" className="text-sm px-3 py-1 badge-gold">
          {tierCounts.gold} Gold
        </Badge>
        <Badge variant="secondary" className="text-sm px-3 py-1 badge-platinum">
          {tierCounts.platinum} Platinum
        </Badge>
      </div>

      {/* Achievements Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {(achievements || DEMO_ACHIEVEMENTS).map((achievement: any) => {
          const Icon = Icons[achievement.icon as keyof typeof Icons] as React.ComponentType<{ className?: string }>;
          const isUnlocked = totalXp >= achievement.xp_required;
          const progress = Math.min(100, Math.round((totalXp / achievement.xp_required) * 100));
          const colors = BADGE_COLORS[achievement.badge_type] || BADGE_COLORS.bronze;

          return (
            <Card
              key={achievement.id}
              className={cn(
                "achievement-card relative overflow-hidden",
                isUnlocked ? `achievement-unlocked ${colors.border} border-2` : "achievement-locked"
              )}
            >
              <CardContent className="pt-6 text-center">
                {/* Lock overlay */}
                {!isUnlocked && (
                  <div className="absolute top-2 right-2">
                    <Icons.Lock className="h-4 w-4 text-muted-foreground" />
                  </div>
                )}

                {/* Icon */}
                <div className={cn(
                  "w-16 h-16 rounded-full mx-auto mb-3 flex items-center justify-center",
                  isUnlocked ? colors.bg : "bg-muted"
                )}>
                  {Icon && (
                    <Icon className={cn(
                      "h-8 w-8",
                      isUnlocked ? colors.text : "text-muted-foreground"
                    )} />
                  )}
                </div>

                {/* Info */}
                <h3 className="font-semibold text-sm text-foreground mb-1">{achievement.name}</h3>
                <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{achievement.description}</p>

                {/* Badge Type */}
                <Badge
                  variant="secondary"
                  className={cn(
                    "text-[10px] capitalize mb-3",
                    `badge-${achievement.badge_type}`
                  )}
                >
                  {achievement.badge_type}
                </Badge>

                {/* Progress */}
                <div className="mt-2">
                  <div className="w-full bg-border rounded-full h-1.5 mb-1">
                    <div
                      className={cn(
                        "h-1.5 rounded-full transition-all",
                        isUnlocked ? "bg-primary" : "bg-muted-foreground/30"
                      )}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    {isUnlocked ? "Unlocked!" : `${totalXp}/${achievement.xp_required} XP`}
                  </p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

export default AchievementsPage;
