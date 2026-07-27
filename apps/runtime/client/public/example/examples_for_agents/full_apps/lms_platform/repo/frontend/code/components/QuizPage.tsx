import {
  React,
  useModel,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  Progress,
  RadioGroup,
  RadioGroupItem,
  Checkbox,
  Label,
  Separator,
  Icons,
  cn,
} from "@exepad/sdk";

interface QuizQuestion {
  id: number;
  question: string;
  type: "single" | "multiple";
  options: string[];
  correctAnswers: number[];
  explanation: string;
}

const DEMO_QUESTIONS: QuizQuestion[] = [
  {
    id: 1,
    question: "What is the primary purpose of the useEffect hook in React?",
    type: "single",
    options: [
      "To define component state variables",
      "To perform side effects in function components",
      "To create context providers",
      "To optimize component rendering",
    ],
    correctAnswers: [1],
    explanation: "useEffect is designed for performing side effects such as data fetching, subscriptions, or DOM manipulation in function components. It runs after the component renders.",
  },
  {
    id: 2,
    question: "Which of the following are valid React Hook rules?",
    type: "multiple",
    options: [
      "Only call hooks at the top level",
      "Hooks can be called inside loops",
      "Only call hooks from React functions",
      "Hook names must start with 'use'",
    ],
    correctAnswers: [0, 2, 3],
    explanation: "React hooks must be called at the top level (not in loops/conditions), only from React function components or custom hooks, and custom hooks must be prefixed with 'use'.",
  },
  {
    id: 3,
    question: "What does the useMemo hook return?",
    type: "single",
    options: [
      "A mutable ref object",
      "A memoized value",
      "A state setter function",
      "A context consumer",
    ],
    correctAnswers: [1],
    explanation: "useMemo returns a memoized value that only recomputes when its dependencies change. This is useful for expensive calculations that shouldn't run on every render.",
  },
  {
    id: 4,
    question: "In TypeScript with React, which type should you use for a component that accepts children?",
    type: "single",
    options: [
      "React.FC<Props>",
      "React.PropsWithChildren<Props>",
      "React.ChildrenProps<Props>",
      "React.ComponentChildren<Props>",
    ],
    correctAnswers: [1],
    explanation: "React.PropsWithChildren<Props> is the idiomatic way to type components that accept children. It adds a 'children?: React.ReactNode' property to your props type.",
  },
  {
    id: 5,
    question: "Which of the following cause a React component to re-render?",
    type: "multiple",
    options: [
      "State change via useState setter",
      "Parent component re-renders",
      "Reading a ref value",
      "Context value update",
    ],
    correctAnswers: [0, 1, 3],
    explanation: "Components re-render when their state changes, when their parent re-renders (unless wrapped in React.memo), or when a consumed context value changes. Ref changes do not trigger re-renders.",
  },
];

const DEMO_QUIZ_ATTEMPTS = [
  { id: 1, lesson_id: 4, score: 80, submitted_at: "2026-03-20T14:30:00Z", quiz_title: "Module 1 Quiz - React Basics" },
  { id: 2, lesson_id: 12, score: 92, submitted_at: "2026-03-18T10:15:00Z", quiz_title: "Final Project Quiz" },
];

export default function QuizPage() {
  const attemptsModel = useModel("quiz_attempts");
  const attempts = (attemptsModel?.data as any[] | null) ?? DEMO_QUIZ_ATTEMPTS;
  const allAttempts = (attempts || DEMO_QUIZ_ATTEMPTS) as any[];

  const [activeQuiz, setActiveQuiz] = React.useState(false);
  const [currentQuestion, setCurrentQuestion] = React.useState(0);
  const [answers, setAnswers] = React.useState<Record<number, number[]>>({});
  const [submitted, setSubmitted] = React.useState(false);
  const [timeLeft, setTimeLeft] = React.useState(600);

  React.useEffect(() => {
    if (!activeQuiz || submitted || timeLeft <= 0) return;
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          setSubmitted(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [activeQuiz, submitted, timeLeft]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const handleSingleAnswer = (questionId: number, optionIndex: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: [parseInt(optionIndex)] }));
  };

  const handleMultiAnswer = (questionId: number, optionIndex: number, checked: boolean) => {
    setAnswers((prev) => {
      const current = prev[questionId] || [];
      if (checked) return { ...prev, [questionId]: [...current, optionIndex] };
      return { ...prev, [questionId]: current.filter((i) => i !== optionIndex) };
    });
  };

  const handleSubmit = () => setSubmitted(true);

  const calculateScore = () => {
    let correct = 0;
    DEMO_QUESTIONS.forEach((q) => {
      const userAnswers = (answers[q.id] || []).sort();
      const correctAnswers = q.correctAnswers.sort();
      if (
        userAnswers.length === correctAnswers.length &&
        userAnswers.every((a, i) => a === correctAnswers[i])
      ) {
        correct++;
      }
    });
    return Math.round((correct / DEMO_QUESTIONS.length) * 100);
  };

  const startQuiz = () => {
    setActiveQuiz(true);
    setCurrentQuestion(0);
    setAnswers({});
    setSubmitted(false);
    setTimeLeft(600);
  };

  if (!activeQuiz) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Quizzes</h1>
          <p className="text-sm text-muted-foreground">Test your knowledge and track your scores</p>
        </div>

        {/* Available Quiz */}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <Icons.FileQuestion className="w-7 h-7 text-primary" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">React Hooks & TypeScript Quiz</h3>
                <p className="text-sm text-muted-foreground mt-0.5">5 questions &middot; 10 minutes &middot; Module 2</p>
              </div>
              <Button onClick={startQuiz}>
                <Icons.Play className="w-4 h-4 mr-2" />
                Start Quiz
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Past Attempts */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">Past Attempts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {allAttempts.map((attempt: any) => (
              <div key={attempt.id} className="flex items-center gap-4 p-3 rounded-lg border border-border">
                <div className={cn(
                  "w-12 h-12 rounded-lg flex items-center justify-center shrink-0",
                  attempt.score >= 80 ? "bg-green-50" : attempt.score >= 60 ? "bg-amber-50" : "bg-red-50"
                )}>
                  <span className={cn(
                    "text-lg font-bold",
                    attempt.score >= 80 ? "text-green-600" : attempt.score >= 60 ? "text-amber-600" : "text-red-600"
                  )}>
                    {attempt.score}%
                  </span>
                </div>
                <div className="flex-1">
                  <h4 className="text-sm font-medium text-foreground">{attempt.quiz_title}</h4>
                  <p className="text-xs text-muted-foreground">
                    {new Date(attempt.submitted_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </p>
                </div>
                <Badge variant={attempt.score >= 80 ? "default" : "secondary"} className={cn(attempt.score >= 80 && "bg-green-500")}>
                  {attempt.score >= 80 ? "Passed" : "Try Again"}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Results View
  if (submitted) {
    const score = calculateScore();
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-6">
        <Card className="text-center">
          <CardContent className="p-8">
            <div className={cn(
              "w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-4",
              score >= 80 ? "bg-green-50" : score >= 60 ? "bg-amber-50" : "bg-red-50"
            )}>
              {score >= 80 ? (
                <Icons.Trophy className="w-12 h-12 text-green-500" />
              ) : (
                <Icons.Target className="w-12 h-12 text-amber-500" />
              )}
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-1">
              {score >= 80 ? "Great job!" : "Keep practicing!"}
            </h2>
            <p className="text-4xl font-bold text-primary my-3">{score}%</p>
            <p className="text-muted-foreground text-sm">
              {Math.round((score / 100) * DEMO_QUESTIONS.length)} of {DEMO_QUESTIONS.length} correct
            </p>
            <div className="flex gap-3 justify-center mt-6">
              <Button variant="outline" onClick={startQuiz}>Retry Quiz</Button>
              <Button onClick={() => setActiveQuiz(false)}>Back to Quizzes</Button>
            </div>
          </CardContent>
        </Card>

        {/* Question Review */}
        <div className="space-y-4">
          {DEMO_QUESTIONS.map((q, idx) => {
            const userAnswers = answers[q.id] || [];
            const isCorrect =
              userAnswers.length === q.correctAnswers.length &&
              userAnswers.sort().every((a, i) => a === q.correctAnswers.sort()[i]);

            return (
              <Card key={q.id} className={cn("border-l-4", isCorrect ? "border-l-green-500" : "border-l-red-500")}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-2 mb-3">
                    {isCorrect ? (
                      <Icons.CheckCircle className="w-5 h-5 text-green-500 shrink-0 mt-0.5" />
                    ) : (
                      <Icons.XCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                    )}
                    <p className="text-sm font-medium text-foreground">Q{idx + 1}: {q.question}</p>
                  </div>
                  <div className="ml-7 space-y-1.5">
                    {q.options.map((opt, oi) => {
                      const isUserAnswer = userAnswers.includes(oi);
                      const isCorrectAnswer = q.correctAnswers.includes(oi);
                      return (
                        <div
                          key={oi}
                          className={cn(
                            "text-sm px-3 py-1.5 rounded",
                            isCorrectAnswer && "bg-green-50 text-green-700 font-medium",
                            isUserAnswer && !isCorrectAnswer && "bg-red-50 text-red-700 line-through"
                          )}
                        >
                          {opt}
                        </div>
                      );
                    })}
                    <p className="text-xs text-muted-foreground mt-2 italic">{q.explanation}</p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    );
  }

  // Active Quiz View
  const question = DEMO_QUESTIONS[currentQuestion];
  const answeredCount = Object.keys(answers).length;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Quiz Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-foreground">React Hooks & TypeScript Quiz</h2>
        <div className="flex items-center gap-3">
          <Badge variant={timeLeft < 60 ? "destructive" : "secondary"} className="text-sm px-3 py-1">
            <Icons.Timer className="w-4 h-4 mr-1" />
            {formatTime(timeLeft)}
          </Badge>
          <span className="text-sm text-muted-foreground">
            {answeredCount}/{DEMO_QUESTIONS.length} answered
          </span>
        </div>
      </div>

      <Progress value={(answeredCount / DEMO_QUESTIONS.length) * 100} className="h-2" />

      {/* Question */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <Badge variant="outline">Question {currentQuestion + 1}/{DEMO_QUESTIONS.length}</Badge>
            <Badge variant="secondary" className="text-xs">
              {question.type === "single" ? "Single Choice" : "Multiple Choice"}
            </Badge>
          </div>

          <h3 className="text-lg font-semibold text-foreground mb-6">{question.question}</h3>

          {question.type === "single" ? (
            <RadioGroup
              value={answers[question.id]?.[0]?.toString() || ""}
              onValueChange={(val: string) => handleSingleAnswer(question.id, val)}
              className="space-y-3"
            >
              {question.options.map((option, idx) => (
                <Label
                  key={idx}
                  htmlFor={`q${question.id}-o${idx}`}
                  className={cn(
                    "quiz-option flex items-center gap-3 p-3 rounded-lg border border-border cursor-pointer hover:bg-muted",
                    answers[question.id]?.includes(idx) && "border-primary bg-primary/5"
                  )}
                >
                  <RadioGroupItem value={idx.toString()} id={`q${question.id}-o${idx}`} />
                  <span className="text-sm text-foreground">{option}</span>
                </Label>
              ))}
            </RadioGroup>
          ) : (
            <div className="space-y-3">
              {question.options.map((option, idx) => (
                <Label
                  key={idx}
                  htmlFor={`q${question.id}-c${idx}`}
                  className={cn(
                    "quiz-option flex items-center gap-3 p-3 rounded-lg border border-border cursor-pointer hover:bg-muted",
                    answers[question.id]?.includes(idx) && "border-primary bg-primary/5"
                  )}
                >
                  <Checkbox
                    id={`q${question.id}-c${idx}`}
                    checked={answers[question.id]?.includes(idx) || false}
                    onCheckedChange={(checked: boolean) => handleMultiAnswer(question.id, idx, checked)}
                  />
                  <span className="text-sm text-foreground">{option}</span>
                </Label>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          disabled={currentQuestion === 0}
          onClick={() => setCurrentQuestion((prev) => prev - 1)}
        >
          <Icons.ArrowLeft className="w-4 h-4 mr-2" />
          Previous
        </Button>

        <div className="flex gap-1.5">
          {DEMO_QUESTIONS.map((_, idx) => (
            <button
              key={idx}
              onClick={() => setCurrentQuestion(idx)}
              className={cn(
                "w-8 h-8 rounded-full text-xs font-medium transition-colors",
                idx === currentQuestion
                  ? "bg-primary text-primary-foreground"
                  : answers[DEMO_QUESTIONS[idx].id]
                    ? "bg-primary/20 text-primary"
                    : "bg-muted text-muted-foreground"
              )}
            >
              {idx + 1}
            </button>
          ))}
        </div>

        {currentQuestion < DEMO_QUESTIONS.length - 1 ? (
          <Button onClick={() => setCurrentQuestion((prev) => prev + 1)}>
            Next
            <Icons.ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        ) : (
          <Button onClick={handleSubmit} className="bg-green-600 hover:bg-green-700">
            <Icons.Send className="w-4 h-4 mr-2" />
            Submit Quiz
          </Button>
        )}
      </div>
    </div>
  );
}
