import {
  React,
  useModel,
  useHandler,
  useAppState,
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
  AspectRatio,
  Progress,
  Card,
  CardContent,
  Badge,
  Button,
  Icons,
  cn,
} from "@exepad/sdk";
import * as VideoJS from "@exepad/ext-videojs";

interface Lesson {
  id: string;
  title: string;
  duration: string;
  videoUrl: string;
  progress: number;
}

interface Module {
  id: string;
  title: string;
  lessons: Lesson[];
}

const DEMO_COURSE: Module[] = [
  {
    id: "m1",
    title: "Module 1: Getting Started",
    lessons: [
      { id: "l1", title: "Welcome & Course Overview", duration: "5:30", videoUrl: "", progress: 100 },
      { id: "l2", title: "Setting Up Your Environment", duration: "12:15", videoUrl: "", progress: 100 },
      { id: "l3", title: "Your First Project", duration: "18:42", videoUrl: "", progress: 65 },
    ],
  },
  {
    id: "m2",
    title: "Module 2: Core Concepts",
    lessons: [
      { id: "l4", title: "Understanding Components", duration: "22:10", videoUrl: "", progress: 30 },
      { id: "l5", title: "State Management Basics", duration: "19:55", videoUrl: "", progress: 0 },
      { id: "l6", title: "Working with Effects", duration: "16:30", videoUrl: "", progress: 0 },
      { id: "l7", title: "Event Handling Patterns", duration: "14:20", videoUrl: "", progress: 0 },
    ],
  },
  {
    id: "m3",
    title: "Module 3: Advanced Techniques",
    lessons: [
      { id: "l8", title: "Performance Optimization", duration: "25:00", videoUrl: "", progress: 0 },
      { id: "l9", title: "Custom Hooks Deep Dive", duration: "20:45", videoUrl: "", progress: 0 },
      { id: "l10", title: "Testing Strategies", duration: "28:15", videoUrl: "", progress: 0 },
    ],
  },
];

function getStatusBadge(progress: number) {
  if (progress === 100) return <Badge variant="default" className="text-[10px]">Complete</Badge>;
  if (progress > 0) return <Badge variant="secondary" className="text-[10px]">In Progress</Badge>;
  return <Badge variant="outline" className="text-[10px]">Not Started</Badge>;
}

function VideoCoursePlayer() {
  // In a real app: const { data: course } = useModel("course");
  const markComplete = useHandler("markComplete");
  const [currentLessonId, setCurrentLessonId] = useAppState<string>("currentLessonId", "l3");
  const [lessonProgress, setLessonProgress] = useAppState<Record<string, number>>(
    "lessonProgress",
    Object.fromEntries(DEMO_COURSE.flatMap((m) => m.lessons.map((l) => [l.id, l.progress])))
  );
  const [showCompletion, setShowCompletion] = useAppState<boolean>("showCompletion", false);
  const videoRef = React.useRef<HTMLDivElement>(null);
  const playerRef = React.useRef<any>(null);

  const currentLesson = React.useMemo(() => {
    for (const m of DEMO_COURSE) {
      const lesson = m.lessons.find((l) => l.id === currentLessonId);
      if (lesson) return lesson;
    }
    return DEMO_COURSE[0].lessons[0];
  }, [currentLessonId]);

  const totalLessons = DEMO_COURSE.reduce((acc, m) => acc + m.lessons.length, 0);
  const completedLessons = Object.values(lessonProgress).filter((p) => p === 100).length;
  const overallProgress = Math.round((completedLessons / totalLessons) * 100);

  React.useEffect(() => {
    if (!videoRef.current) return;

    const player = VideoJS.default(videoRef.current, {
      controls: true,
      responsive: true,
      fluid: false,
      playbackRates: [0.5, 1, 1.25, 1.5, 2],
      sources: currentLesson.videoUrl
        ? [{ src: currentLesson.videoUrl, type: "video/mp4" }]
        : [],
      poster: "",
    });

    playerRef.current = player;

    player.on("ended", () => {
      setShowCompletion(true);
    });

    player.on("timeupdate", () => {
      const duration = player.duration() || 1;
      const current = player.currentTime() || 0;
      const pct = Math.round((current / duration) * 100);
      setLessonProgress((prev: Record<string, number>) => ({
        ...prev,
        [currentLessonId]: Math.max(prev[currentLessonId] || 0, pct),
      }));
    });

    return () => {
      if (playerRef.current) {
        playerRef.current.dispose();
        playerRef.current = null;
      }
    };
  }, [currentLessonId]);

  const handleMarkComplete = () => {
    setLessonProgress((prev: Record<string, number>) => ({ ...prev, [currentLessonId]: 100 }));
    markComplete({ lessonId: currentLessonId });
    setShowCompletion(false);
  };

  const selectLesson = (lessonId: string) => {
    setCurrentLessonId(lessonId);
  };

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      {/* Video area */}
      <div className="flex-1 min-w-0 space-y-4">
        <Card>
          <CardContent className="p-0">
            <AspectRatio ratio={16 / 9}>
              <div className="w-full h-full bg-black rounded-t-lg overflow-hidden">
                <div ref={videoRef} className="video-js vjs-big-play-centered w-full h-full">
                  {!currentLesson.videoUrl && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-white/60 gap-2 z-10">
                      <Icons.Play className="h-16 w-16 opacity-30" />
                      <p className="text-sm">No video source loaded</p>
                      <p className="text-xs opacity-50">Connect a video URL to play content</p>
                    </div>
                  )}
                </div>
              </div>
            </AspectRatio>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold">{currentLesson.title}</h3>
                <p className="text-xs text-muted-foreground mt-1">Duration: {currentLesson.duration}</p>
              </div>
              <div className="flex items-center gap-2">
                {getStatusBadge(lessonProgress[currentLessonId] || 0)}
                <AlertDialog open={showCompletion} onOpenChange={setShowCompletion}>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => setShowCompletion(true)}
                      disabled={lessonProgress[currentLessonId] === 100}
                    >
                      <Icons.CheckCircle className="h-4 w-4 mr-1" />
                      Mark Complete
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Lesson Complete!</AlertDialogTitle>
                      <AlertDialogDescription>
                        Mark "{currentLesson.title}" as completed? This will update your course progress.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleMarkComplete}>
                        Confirm Complete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Chapter sidebar */}
      <div className="w-full lg:w-80 shrink-0">
        <Card className="h-full">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-4">
              <h4 className="font-semibold text-sm">Course Content</h4>
              <Badge variant="secondary" className="text-xs">
                {completedLessons}/{totalLessons} lessons
              </Badge>
            </div>
            <Progress value={overallProgress} className="h-2 mb-4" />
            <Accordion type="multiple" defaultValue={["m1", "m2", "m3"]}>
              {DEMO_COURSE.map((module) => (
                <AccordionItem key={module.id} value={module.id}>
                  <AccordionTrigger className="text-sm py-2">{module.title}</AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-1">
                      {module.lessons.map((lesson) => {
                        const prog = lessonProgress[lesson.id] || 0;
                        const isActive = lesson.id === currentLessonId;
                        return (
                          <button
                            key={lesson.id}
                            onClick={() => selectLesson(lesson.id)}
                            className={cn(
                              "w-full text-left px-3 py-2 rounded-md transition-colors text-sm",
                              "hover:bg-accent",
                              isActive && "bg-accent border border-primary/20"
                            )}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                {prog === 100 ? (
                                  <Icons.CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />
                                ) : isActive ? (
                                  <Icons.PlayCircle className="h-3.5 w-3.5 text-primary shrink-0" />
                                ) : (
                                  <Icons.Circle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                )}
                                <span className="truncate">{lesson.title}</span>
                              </div>
                              <span className="text-[10px] text-muted-foreground shrink-0">
                                {lesson.duration}
                              </span>
                            </div>
                            {prog > 0 && prog < 100 && (
                              <Progress value={prog} className="h-1 mt-1.5" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default VideoCoursePlayer;
