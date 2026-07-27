import {
  React,
  cn,
  Icons,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Textarea,
  Badge,
  navigate,
  toast,
  useModel,
} from "@exepad/sdk";

/* ── Demo Data ── */

const DEMO_SURVEYS: Record<number, { title: string; description: string }> = {
  1: { title: "Customer Satisfaction Survey", description: "Help us understand how satisfied you are with our products and services. Your feedback drives our improvements." },
  2: { title: "Employee Engagement Survey", description: "Share your thoughts on workplace culture, management, and growth opportunities. All responses are anonymous." },
  3: { title: "Product Feedback Survey", description: "Tell us what you think about our latest product updates and what features you'd like to see next." },
};

const DEMO_QUESTIONS: Record<number, Array<{ id: number; question_text: string; question_type: string; options: string | null; is_required: number; sort_order: number }>> = {
  1: [
    { id: 1, question_text: "How satisfied are you with our overall service?", question_type: "rating", options: null, is_required: 1, sort_order: 1 },
    { id: 2, question_text: "Which aspect of our service do you value most?", question_type: "multiple_choice", options: '["Speed of delivery","Product quality","Customer support","Pricing","Ease of use"]', is_required: 1, sort_order: 2 },
    { id: 3, question_text: "Would you recommend us to a friend or colleague?", question_type: "yes_no", options: null, is_required: 1, sort_order: 3 },
    { id: 4, question_text: "How would you rate our customer support?", question_type: "rating", options: null, is_required: 1, sort_order: 4 },
    { id: 5, question_text: "What could we do better? Please share any suggestions.", question_type: "text", options: null, is_required: 0, sort_order: 5 },
  ],
  2: [
    { id: 6, question_text: "How would you rate your overall job satisfaction?", question_type: "rating", options: null, is_required: 1, sort_order: 1 },
    { id: 7, question_text: "Do you feel your work is recognized and appreciated?", question_type: "yes_no", options: null, is_required: 1, sort_order: 2 },
    { id: 8, question_text: "Which area needs the most improvement?", question_type: "multiple_choice", options: '["Communication","Work-life balance","Career growth","Compensation","Team collaboration"]', is_required: 1, sort_order: 3 },
    { id: 9, question_text: "How likely are you to stay with the company for the next 2 years?", question_type: "rating", options: null, is_required: 1, sort_order: 4 },
    { id: 10, question_text: "What changes would make the biggest positive impact on your work experience?", question_type: "text", options: null, is_required: 0, sort_order: 5 },
  ],
  3: [
    { id: 11, question_text: "How would you rate the new dashboard redesign?", question_type: "rating", options: null, is_required: 1, sort_order: 1 },
    { id: 12, question_text: "Which new feature do you use the most?", question_type: "multiple_choice", options: '["Dark mode","Export to PDF","Real-time collaboration","Advanced filters","API integrations"]', is_required: 1, sort_order: 2 },
    { id: 13, question_text: "Did the latest update improve your workflow?", question_type: "yes_no", options: null, is_required: 1, sort_order: 3 },
    { id: 14, question_text: "How intuitive is the new navigation?", question_type: "rating", options: null, is_required: 1, sort_order: 4 },
    { id: 15, question_text: "What feature would you most like to see added next?", question_type: "text", options: null, is_required: 0, sort_order: 5 },
  ],
};

function SurveyTaker({ className }: { className?: string }) {
  const path = typeof window !== "undefined" ? window.location.pathname : "/take/1";
  const segments = path.split("/");
  const surveyId = parseInt(segments[segments.length - 1]) || 1;

  const [step, setStep] = React.useState(0);
  const [answers, setAnswers] = React.useState<Record<number, any>>({});
  const [submitted, setSubmitted] = React.useState(false);

  const survey = DEMO_SURVEYS[surveyId] || DEMO_SURVEYS[1];
  const questions = DEMO_QUESTIONS[surveyId] || DEMO_QUESTIONS[1];
  const totalSteps = questions.length;
  const currentQ = questions[step];
  const progressPct = Math.round(((step + 1) / totalSteps) * 100);

  const setAnswer = (qId: number, value: any) => {
    setAnswers((prev) => ({ ...prev, [qId]: value }));
  };

  const canProceed = () => {
    if (!currentQ) return false;
    if (!currentQ.is_required) return true;
    const ans = answers[currentQ.id];
    if (ans === undefined || ans === null || ans === "") return false;
    return true;
  };

  const handleSubmit = () => {
    setSubmitted(true);
    toast({
      title: "Survey submitted!",
      description: "Thank you for your feedback.",
    });
  };

  if (submitted) {
    return (
      <div className={cn("p-6 flex items-center justify-center min-h-[60vh]", className)}>
        <Card className="w-full max-w-lg text-center">
          <CardContent className="pt-12 pb-12">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
              <Icons.CheckCircle className="h-8 w-8 text-green-600" />
            </div>
            <h2 className="text-2xl font-bold text-foreground mb-2">Thank You!</h2>
            <p className="text-sm text-muted-foreground mb-6">
              Your response to "{survey.title}" has been recorded. We appreciate your time and feedback.
            </p>
            <div className="flex items-center justify-center gap-3">
              <Button variant="outline" onClick={() => navigate("/surveys")}>
                <Icons.ClipboardList className="h-4 w-4 mr-1.5" />
                Back to Surveys
              </Button>
              <Button onClick={() => navigate("/results")}>
                <Icons.BarChart3 className="h-4 w-4 mr-1.5" />
                View Results
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className={cn("p-6 max-w-2xl mx-auto space-y-6", className)}>
      {/* Survey Title */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => navigate("/surveys")}>
            <Icons.ArrowLeft className="h-4 w-4" />
          </Button>
          <Badge className="bg-primary/10 text-primary border-0 text-[10px]">
            Survey #{surveyId}
          </Badge>
        </div>
        <h2 className="text-2xl font-bold text-foreground tracking-tight">{survey.title}</h2>
        <p className="text-sm text-muted-foreground mt-1">{survey.description}</p>
      </div>

      {/* Progress Bar */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-foreground">
            Question {step + 1} of {totalSteps}
          </span>
          <span className="text-xs text-muted-foreground">{progressPct}% complete</span>
        </div>
        <div className="w-full bg-border rounded-full h-2.5">
          <div
            className="bg-primary h-2.5 rounded-full progress-bar"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Question Card */}
      {currentQ && (
        <Card>
          <CardHeader>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-sm font-bold text-primary">{step + 1}</span>
              </div>
              <div>
                <CardTitle className="text-base">{currentQ.question_text}</CardTitle>
                <CardDescription className="mt-1">
                  {currentQ.is_required ? "Required" : "Optional"} &middot;{" "}
                  {currentQ.question_type === "multiple_choice" && "Select one option"}
                  {currentQ.question_type === "rating" && "Rate from 1 to 5 stars"}
                  {currentQ.question_type === "text" && "Type your answer below"}
                  {currentQ.question_type === "yes_no" && "Choose Yes or No"}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {/* Multiple Choice */}
            {currentQ.question_type === "multiple_choice" && (() => {
              const opts: string[] = currentQ.options ? JSON.parse(currentQ.options) : [];
              return (
                <div className="space-y-2">
                  {opts.map((opt, idx) => (
                    <button
                      key={idx}
                      onClick={() => setAnswer(currentQ.id, opt)}
                      className={cn(
                        "w-full flex items-center gap-3 p-3 rounded-lg border text-sm text-left transition-colors",
                        answers[currentQ.id] === opt
                          ? "border-primary bg-primary/5 text-foreground"
                          : "border-border hover:border-primary/30 hover:bg-muted/50 text-foreground"
                      )}
                    >
                      <div className={cn(
                        "w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0",
                        answers[currentQ.id] === opt ? "border-primary" : "border-muted-foreground/30"
                      )}>
                        {answers[currentQ.id] === opt && (
                          <div className="w-2.5 h-2.5 rounded-full bg-primary" />
                        )}
                      </div>
                      {opt}
                    </button>
                  ))}
                </div>
              );
            })()}

            {/* Rating */}
            {currentQ.question_type === "rating" && (
              <div className="flex items-center gap-2 py-4 justify-center">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    onClick={() => setAnswer(currentQ.id, star)}
                    className="star-rating p-1"
                  >
                    <Icons.Star
                      className={cn(
                        "h-10 w-10 transition-colors",
                        (answers[currentQ.id] || 0) >= star
                          ? "text-amber-400 fill-amber-400"
                          : "text-muted-foreground/20"
                      )}
                    />
                  </button>
                ))}
                {answers[currentQ.id] && (
                  <span className="ml-3 text-sm font-medium text-foreground">
                    {answers[currentQ.id]} / 5
                  </span>
                )}
              </div>
            )}

            {/* Text */}
            {currentQ.question_type === "text" && (
              <Textarea
                placeholder="Type your answer here..."
                value={answers[currentQ.id] || ""}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setAnswer(currentQ.id, e.target.value)}
                className="min-h-[120px] resize-none"
              />
            )}

            {/* Yes/No */}
            {currentQ.question_type === "yes_no" && (
              <div className="flex items-center gap-3 py-4 justify-center">
                <Button
                  size="lg"
                  variant={answers[currentQ.id] === "yes" ? "default" : "outline"}
                  className={cn(
                    "min-w-[120px]",
                    answers[currentQ.id] === "yes" && "bg-green-600 hover:bg-green-700 text-white"
                  )}
                  onClick={() => setAnswer(currentQ.id, "yes")}
                >
                  <Icons.ThumbsUp className="h-5 w-5 mr-2" />
                  Yes
                </Button>
                <Button
                  size="lg"
                  variant={answers[currentQ.id] === "no" ? "default" : "outline"}
                  className={cn(
                    "min-w-[120px]",
                    answers[currentQ.id] === "no" && "bg-red-500 hover:bg-red-600 text-white"
                  )}
                  onClick={() => setAnswer(currentQ.id, "no")}
                >
                  <Icons.ThumbsDown className="h-5 w-5 mr-2" />
                  No
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          disabled={step === 0}
          onClick={() => setStep((s) => Math.max(0, s - 1))}
        >
          <Icons.ArrowLeft className="h-4 w-4 mr-1.5" />
          Previous
        </Button>

        {step < totalSteps - 1 ? (
          <Button
            disabled={!canProceed()}
            onClick={() => setStep((s) => Math.min(totalSteps - 1, s + 1))}
          >
            Next
            <Icons.ArrowRight className="h-4 w-4 ml-1.5" />
          </Button>
        ) : (
          <Button
            disabled={!canProceed()}
            onClick={handleSubmit}
            className="bg-green-600 hover:bg-green-700 text-white"
          >
            <Icons.Check className="h-4 w-4 mr-1.5" />
            Submit Survey
          </Button>
        )}
      </div>
    </div>
  );
}

export default SurveyTaker;
