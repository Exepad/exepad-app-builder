import { React, useAppState, useNavigation, Button, Card, CardContent, CardHeader, CardTitle, Badge, Icons, cn, toast } from "@exepad/sdk";

function QuizResults() {
  const navigation = useNavigation();
  const [, setActiveQuizId] = useAppState("activeQuizId", null);
  const [, setQuizScore] = useAppState("quizScore", 0);

  const [results, setResults] = React.useState<any>(null);

  React.useEffect(() => {
    const stored = sessionStorage.getItem("quiz_results");
    if (stored) {
      setResults(JSON.parse(stored));
    }
    setActiveQuizId(null);
    setQuizScore(0);
  }, []);

  if (!results) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 text-center">
        <Icons.HelpCircle className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
        <h2 className="text-2xl font-bold mb-2">No Results Found</h2>
        <p className="text-muted-foreground mb-6">Take a quiz first to see your results here.</p>
        <Button onClick={() => navigation.navigate("/browse")}>
          <Icons.Play className="h-4 w-4 mr-2" />
          Browse Quizzes
        </Button>
      </div>
    );
  }

  const { quizId, quizTitle, score, totalQuestions, timeTaken, answers, questions } = results;
  const percentage = Math.round((score / totalQuestions) * 100);

  const getGrade = (pct: number) => {
    if (pct >= 90) return { letter: "A", color: "text-green-600", bg: "bg-green-100 dark:bg-green-900", label: "Excellent!" };
    if (pct >= 80) return { letter: "B", color: "text-blue-600", bg: "bg-blue-100 dark:bg-blue-900", label: "Great Job!" };
    if (pct >= 70) return { letter: "C", color: "text-yellow-600", bg: "bg-yellow-100 dark:bg-yellow-900", label: "Good Effort!" };
    if (pct >= 60) return { letter: "D", color: "text-orange-600", bg: "bg-orange-100 dark:bg-orange-900", label: "Keep Trying!" };
    return { letter: "F", color: "text-red-600", bg: "bg-red-100 dark:bg-red-900", label: "Study More!" };
  };

  const grade = getGrade(percentage);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      {/* Score Card */}
      <Card className="mb-8 overflow-hidden">
        <div className="bg-gradient-to-br from-primary/10 via-accent/30 to-secondary/20 p-8 text-center">
          <div className={cn("inline-flex h-24 w-24 rounded-full items-center justify-center mb-4", grade.bg)}>
            <span className={cn("text-4xl font-extrabold", grade.color)}>{grade.letter}</span>
          </div>
          <h1 className="text-3xl font-extrabold mb-1">{grade.label}</h1>
          <p className="text-lg text-muted-foreground mb-4">{quizTitle}</p>

          <div className="flex items-center justify-center gap-2 text-4xl font-extrabold mb-2">
            <span className="text-primary">{score}</span>
            <span className="text-muted-foreground text-2xl">out of</span>
            <span>{totalQuestions}</span>
          </div>
          <div className="text-xl font-bold text-primary">{percentage}%</div>

          <div className="flex items-center justify-center gap-6 mt-6 text-sm text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <Icons.Clock className="h-4 w-4" />
              <span>Time: {formatTime(timeTaken)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Icons.CheckCircle className="h-4 w-4 text-green-600" />
              <span>{score} correct</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Icons.XCircle className="h-4 w-4 text-red-600" />
              <span>{totalQuestions - score} wrong</span>
            </div>
          </div>
        </div>

        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button onClick={() => navigation.navigate(`/play/${quizId}`)}>
              <Icons.RotateCcw className="h-4 w-4 mr-2" />
              Play Again
            </Button>
            <Button variant="outline" onClick={() => navigation.navigate("/browse")}>
              <Icons.Search className="h-4 w-4 mr-2" />
              Browse More Quizzes
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const text = `I scored ${score}/${totalQuestions} (${percentage}%) on ${quizTitle} in QuizMaster!`;
                if (navigator.clipboard) {
                  navigator.clipboard.writeText(text);
                  toast({ title: "Copied!", description: "Score copied to clipboard" });
                }
              }}
            >
              <Icons.Share2 className="h-4 w-4 mr-2" />
              Share Score
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Question Review */}
      <div className="mb-6">
        <h2 className="text-xl font-bold mb-4">Question Review</h2>
        <div className="space-y-4">
          {questions.map((q: any, idx: number) => {
            const answer = answers[idx];
            const isCorrect = answer?.selected === q.correct_answer;
            const wasTimeout = answer?.selected === null;

            return (
              <Card key={idx} className={cn("border-l-4", isCorrect ? "border-l-green-500" : "border-l-red-500")}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-xs">Q{idx + 1}</Badge>
                      {isCorrect ? (
                        <Badge className="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 text-xs">
                          <Icons.CheckCircle className="h-3 w-3 mr-1" />
                          Correct
                        </Badge>
                      ) : wasTimeout ? (
                        <Badge className="bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300 text-xs">
                          <Icons.Clock className="h-3 w-3 mr-1" />
                          Timed Out
                        </Badge>
                      ) : (
                        <Badge className="bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300 text-xs">
                          <Icons.XCircle className="h-3 w-3 mr-1" />
                          Wrong
                        </Badge>
                      )}
                    </div>
                  </div>

                  <p className="font-medium mb-3">{q.question_text}</p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
                    {q.options.map((opt: string, optIdx: number) => (
                      <div
                        key={optIdx}
                        className={cn(
                          "px-3 py-2 rounded-md text-sm border",
                          optIdx === q.correct_answer && "bg-green-50 border-green-300 text-green-700 dark:bg-green-950 dark:border-green-700 dark:text-green-300",
                          answer?.selected === optIdx && optIdx !== q.correct_answer && "bg-red-50 border-red-300 text-red-700 dark:bg-red-950 dark:border-red-700 dark:text-red-300",
                          optIdx !== q.correct_answer && answer?.selected !== optIdx && "border-border text-muted-foreground"
                        )}
                      >
                        <span className="font-medium mr-2">{String.fromCharCode(65 + optIdx)}.</span>
                        {opt}
                        {optIdx === q.correct_answer && <Icons.Check className="inline h-3.5 w-3.5 ml-1" />}
                        {answer?.selected === optIdx && optIdx !== q.correct_answer && <Icons.X className="inline h-3.5 w-3.5 ml-1" />}
                      </div>
                    ))}
                  </div>

                  <div className="bg-muted/50 rounded-md p-3 text-sm">
                    <span className="font-medium text-primary">Explanation: </span>
                    <span className="text-muted-foreground">{q.explanation}</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default QuizResults;
