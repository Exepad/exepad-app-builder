import { React, useModel, useAppState, useNavigation, Button, Card, CardContent, Badge, Icons, cn, toast } from "@exepad/sdk";

const DEMO_QUESTIONS: Record<number, Array<{ question_text: string; options: string[]; correct_answer: number; explanation: string }>> = {
  1: [
    { question_text: "What is the chemical symbol for water?", options: ["H2O", "CO2", "NaCl", "O2"], correct_answer: 0, explanation: "Water is composed of two hydrogen atoms and one oxygen atom, giving it the formula H2O." },
    { question_text: "What planet is known as the Red Planet?", options: ["Venus", "Mars", "Jupiter", "Saturn"], correct_answer: 1, explanation: "Mars appears red due to iron oxide (rust) on its surface." },
    { question_text: "What is the powerhouse of the cell?", options: ["Nucleus", "Ribosome", "Mitochondria", "Golgi apparatus"], correct_answer: 2, explanation: "Mitochondria generate most of the cell's supply of ATP." },
    { question_text: "What gas do plants absorb from the atmosphere?", options: ["Oxygen", "Nitrogen", "Carbon dioxide", "Hydrogen"], correct_answer: 2, explanation: "Plants absorb CO2 during photosynthesis." },
    { question_text: "What is the speed of light approximately?", options: ["300,000 km/s", "150,000 km/s", "500,000 km/s", "100,000 km/s"], correct_answer: 0, explanation: "Light travels at approximately 299,792 km/s in a vacuum." },
  ],
  2: [
    { question_text: "In which year did World War II end?", options: ["1943", "1944", "1945", "1946"], correct_answer: 2, explanation: "World War II ended in 1945 with the surrender of Germany and Japan." },
    { question_text: "Who was the first President of the United States?", options: ["Thomas Jefferson", "John Adams", "George Washington", "Benjamin Franklin"], correct_answer: 2, explanation: "George Washington was inaugurated as the first U.S. President in 1789." },
    { question_text: "The Great Wall of China was built to protect against which group?", options: ["Romans", "Mongols", "Japanese", "Persians"], correct_answer: 1, explanation: "The Great Wall was built primarily to defend against Mongol invasions." },
    { question_text: "Which civilization built the pyramids at Giza?", options: ["Roman", "Greek", "Egyptian", "Mesopotamian"], correct_answer: 2, explanation: "The pyramids at Giza were built by the ancient Egyptians around 2560 BCE." },
    { question_text: "The Renaissance began in which country?", options: ["France", "England", "Spain", "Italy"], correct_answer: 3, explanation: "The Renaissance began in Italy in the 14th century, particularly in Florence." },
  ],
  3: [
    { question_text: "What is the largest continent by area?", options: ["Africa", "North America", "Asia", "Europe"], correct_answer: 2, explanation: "Asia is the largest continent at about 44.58 million sq km." },
    { question_text: "Which country has the most natural lakes?", options: ["United States", "Canada", "Russia", "Brazil"], correct_answer: 1, explanation: "Canada has more lakes than all other countries combined." },
    { question_text: "What is the capital of Australia?", options: ["Sydney", "Melbourne", "Canberra", "Perth"], correct_answer: 2, explanation: "Canberra is the capital, chosen as a compromise between Sydney and Melbourne." },
    { question_text: "Which river is the longest in the world?", options: ["Amazon", "Nile", "Mississippi", "Yangtze"], correct_answer: 1, explanation: "The Nile River is traditionally considered the longest at approximately 6,650 km." },
    { question_text: "Mount Everest is on the border of which two countries?", options: ["India and China", "Nepal and China", "Nepal and India", "China and Pakistan"], correct_answer: 1, explanation: "Mount Everest sits on the border between Nepal and Tibet (China)." },
  ],
  4: [
    { question_text: "What does HTML stand for?", options: ["Hyper Text Markup Language", "High Tech Modern Language", "Hyper Transfer Markup Language", "Home Tool Markup Language"], correct_answer: 0, explanation: "HTML stands for HyperText Markup Language." },
    { question_text: "Who is considered the father of computer science?", options: ["Bill Gates", "Steve Jobs", "Alan Turing", "Tim Berners-Lee"], correct_answer: 2, explanation: "Alan Turing is widely considered the father of computer science." },
    { question_text: "What year was the first iPhone released?", options: ["2005", "2006", "2007", "2008"], correct_answer: 2, explanation: "The original iPhone was released on June 29, 2007." },
    { question_text: "What programming language was created by Brendan Eich in 10 days?", options: ["Python", "Java", "JavaScript", "Ruby"], correct_answer: 2, explanation: "Brendan Eich created JavaScript in just 10 days in May 1995." },
    { question_text: "What does CPU stand for?", options: ["Central Processing Unit", "Computer Personal Unit", "Central Program Utility", "Core Processing Unit"], correct_answer: 0, explanation: "CPU stands for Central Processing Unit." },
  ],
  5: [
    { question_text: "Which film won the first Academy Award for Best Picture?", options: ["Sunrise", "Wings", "The Jazz Singer", "Metropolis"], correct_answer: 1, explanation: "Wings (1927) won the first Best Picture award in 1929." },
    { question_text: "Who painted the Mona Lisa?", options: ["Michelangelo", "Raphael", "Leonardo da Vinci", "Donatello"], correct_answer: 2, explanation: "Leonardo da Vinci painted the Mona Lisa between 1503 and 1519." },
    { question_text: "What is the best-selling video game of all time?", options: ["Tetris", "Minecraft", "GTA V", "Wii Sports"], correct_answer: 1, explanation: "Minecraft has sold over 300 million copies." },
    { question_text: "Which band released the album 'Abbey Road'?", options: ["The Rolling Stones", "Led Zeppelin", "The Beatles", "Pink Floyd"], correct_answer: 2, explanation: "The Beatles released Abbey Road in 1969." },
    { question_text: "In Harry Potter, what is the name of Harry's owl?", options: ["Errol", "Hedwig", "Pigwidgeon", "Scabbers"], correct_answer: 1, explanation: "Hedwig is Harry Potter's snowy owl, given to him by Hagrid." },
  ],
  6: [
    { question_text: "In which sport would you perform a 'slam dunk'?", options: ["Volleyball", "Basketball", "Tennis", "Football"], correct_answer: 1, explanation: "A slam dunk is a basketball move." },
    { question_text: "How many players are on a standard soccer team on the field?", options: ["9", "10", "11", "12"], correct_answer: 2, explanation: "A standard soccer team has 11 players on the field." },
    { question_text: "Which country has won the most FIFA World Cup titles?", options: ["Germany", "Argentina", "Italy", "Brazil"], correct_answer: 3, explanation: "Brazil has won the FIFA World Cup five times." },
    { question_text: "What is the maximum score in a single frame of bowling?", options: ["10", "20", "30", "50"], correct_answer: 2, explanation: "The maximum is 30, achieved with a strike followed by two more strikes." },
    { question_text: "Which Olympic sport features poomsae and kyorugi?", options: ["Judo", "Karate", "Taekwondo", "Wrestling"], correct_answer: 2, explanation: "Taekwondo features poomsae (forms) and kyorugi (sparring)." },
  ],
};

const QUIZ_META: Record<number, { title: string; time_limit: number }> = {
  1: { title: "Science Fundamentals", time_limit: 30 },
  2: { title: "World History Highlights", time_limit: 30 },
  3: { title: "Geography Challenge", time_limit: 25 },
  4: { title: "Tech & Computing", time_limit: 35 },
  5: { title: "Entertainment Trivia", time_limit: 20 },
  6: { title: "Sports Legends", time_limit: 25 },
};

const OPTION_LETTERS = ["A", "B", "C", "D"];

function QuizPlayer() {
  const navigation = useNavigation();
  const [, setActiveQuizId] = useAppState("activeQuizId", null);
  const [, setQuizScore] = useAppState("quizScore", 0);

  const pathParts = (navigation.currentPath || "").split("/");
  const quizId = parseInt(pathParts[pathParts.length - 1]) || 1;

  const questions = DEMO_QUESTIONS[quizId] || DEMO_QUESTIONS[1];
  const meta = QUIZ_META[quizId] || QUIZ_META[1];
  const totalQuestions = questions.length;

  const [currentIdx, setCurrentIdx] = React.useState(0);
  const [score, setScore] = React.useState(0);
  const [selectedAnswer, setSelectedAnswer] = React.useState<number | null>(null);
  const [showResult, setShowResult] = React.useState(false);
  const [timeLeft, setTimeLeft] = React.useState(meta.time_limit);
  const [startTime] = React.useState(Date.now());
  const [answers, setAnswers] = React.useState<Array<{ selected: number | null; correct: number }>>([]);
  const [quizFinished, setQuizFinished] = React.useState(false);

  const currentQuestion = questions[currentIdx];

  React.useEffect(() => {
    setActiveQuizId(quizId);
    setQuizScore(0);
    return () => { setActiveQuizId(null); };
  }, [quizId]);

  React.useEffect(() => {
    if (showResult || quizFinished) return;
    if (timeLeft <= 0) {
      handleTimeout();
      return;
    }
    const timer = setTimeout(() => setTimeLeft(t => t - 1), 1000);
    return () => clearTimeout(timer);
  }, [timeLeft, showResult, quizFinished]);

  const handleTimeout = () => {
    setSelectedAnswer(null);
    setShowResult(true);
    setAnswers(prev => [...prev, { selected: null, correct: currentQuestion.correct_answer }]);
    toast({ title: "Time's up!", description: `The correct answer was: ${currentQuestion.options[currentQuestion.correct_answer]}` });
    setTimeout(advanceQuestion, 2000);
  };

  const handleAnswer = (idx: number) => {
    if (showResult) return;
    setSelectedAnswer(idx);
    setShowResult(true);
    const isCorrect = idx === currentQuestion.correct_answer;
    const newScore = isCorrect ? score + 1 : score;
    if (isCorrect) {
      setScore(newScore);
      setQuizScore(newScore);
    }
    setAnswers(prev => [...prev, { selected: idx, correct: currentQuestion.correct_answer }]);
    toast({
      title: isCorrect ? "Correct!" : "Wrong!",
      description: isCorrect ? "Great job!" : `The correct answer was: ${currentQuestion.options[currentQuestion.correct_answer]}`,
    });
    setTimeout(advanceQuestion, 2000);
  };

  const advanceQuestion = () => {
    if (currentIdx + 1 >= totalQuestions) {
      setQuizFinished(true);
      const timeTaken = Math.round((Date.now() - startTime) / 1000);
      const finalScore = score + (selectedAnswer === currentQuestion.correct_answer ? 0 : 0);
      // Store results in sessionStorage for the results page
      sessionStorage.setItem("quiz_results", JSON.stringify({
        quizId,
        quizTitle: meta.title,
        score: answers.length > 0 ? answers.filter((a, i) => i < answers.length && a.selected === a.correct).length + (selectedAnswer === currentQuestion.correct_answer ? 1 : 0) : score,
        totalQuestions,
        timeTaken,
        answers: [...answers],
        questions: questions.map(q => ({ question_text: q.question_text, options: q.options, correct_answer: q.correct_answer, explanation: q.explanation })),
      }));
      navigation.navigate("/results");
      return;
    }
    setCurrentIdx(prev => prev + 1);
    setSelectedAnswer(null);
    setShowResult(false);
    setTimeLeft(meta.time_limit);
  };

  const progress = ((currentIdx) / totalQuestions) * 100;
  const timerPercent = (timeLeft / meta.time_limit) * 100;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      {/* Quiz Title & Progress */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-xl font-bold">{meta.title}</h1>
          <Badge variant="secondary" className="flex items-center gap-1.5">
            <Icons.Zap className="h-3.5 w-3.5 text-primary" />
            <span className="font-semibold">{score}</span>
            <span className="text-muted-foreground">/ {totalQuestions}</span>
          </Badge>
        </div>
        <div className="flex items-center gap-3 text-sm text-muted-foreground mb-3">
          <span>Question {currentIdx + 1} of {totalQuestions}</span>
        </div>
        <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
          <div className="quiz-progress h-full bg-primary rounded-full" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* Timer */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5 text-sm">
            <Icons.Clock className="h-4 w-4" />
            <span className={cn("font-medium", timeLeft <= 5 ? "text-destructive" : "text-foreground")}>{timeLeft}s</span>
          </div>
          <span className="text-xs text-muted-foreground">{meta.time_limit}s per question</span>
        </div>
        <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all duration-1000", timeLeft <= 5 ? "bg-destructive" : timeLeft <= 10 ? "bg-yellow-500" : "bg-primary")}
            style={{ width: `${timerPercent}%` }}
          />
        </div>
      </div>

      {/* Question */}
      <Card className="mb-6">
        <CardContent className="p-6 sm:p-8">
          <p className="text-lg sm:text-xl font-semibold leading-relaxed">{currentQuestion.question_text}</p>
        </CardContent>
      </Card>

      {/* Options */}
      <div className="space-y-3">
        {currentQuestion.options.map((option, idx) => {
          let optionClass = "quiz-option";
          if (showResult) {
            if (idx === currentQuestion.correct_answer) {
              optionClass += " correct";
            } else if (idx === selectedAnswer && idx !== currentQuestion.correct_answer) {
              optionClass += " wrong";
            }
          }
          return (
            <button
              key={idx}
              onClick={() => handleAnswer(idx)}
              disabled={showResult}
              className={cn(
                optionClass,
                "w-full flex items-center gap-4 p-4 rounded-xl border text-left",
                !showResult && "border-border hover:border-primary/50 hover:bg-accent/50 cursor-pointer",
                showResult && idx !== currentQuestion.correct_answer && idx !== selectedAnswer && "opacity-50 border-border",
                showResult && idx === currentQuestion.correct_answer && "border-green-500 bg-green-50 dark:bg-green-950",
                showResult && idx === selectedAnswer && idx !== currentQuestion.correct_answer && "border-red-500 bg-red-50 dark:bg-red-950"
              )}
            >
              <div className={cn(
                "h-10 w-10 rounded-lg flex items-center justify-center text-sm font-bold shrink-0",
                !showResult && "bg-muted text-foreground",
                showResult && idx === currentQuestion.correct_answer && "bg-green-500 text-white",
                showResult && idx === selectedAnswer && idx !== currentQuestion.correct_answer && "bg-red-500 text-white",
                showResult && idx !== currentQuestion.correct_answer && idx !== selectedAnswer && "bg-muted text-muted-foreground"
              )}>
                {OPTION_LETTERS[idx]}
              </div>
              <span className={cn("text-base font-medium", showResult && idx !== currentQuestion.correct_answer && idx !== selectedAnswer && "text-muted-foreground")}>
                {option}
              </span>
              {showResult && idx === currentQuestion.correct_answer && (
                <Icons.CheckCircle className="h-5 w-5 text-green-600 ml-auto shrink-0" />
              )}
              {showResult && idx === selectedAnswer && idx !== currentQuestion.correct_answer && (
                <Icons.XCircle className="h-5 w-5 text-red-600 ml-auto shrink-0" />
              )}
            </button>
          );
        })}
      </div>

      {/* Explanation (shown after answering) */}
      {showResult && (
        <Card className="mt-6 border-primary/20 bg-primary/5">
          <CardContent className="p-4 flex items-start gap-3">
            <Icons.Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-primary mb-1">Explanation</p>
              <p className="text-sm text-muted-foreground">{currentQuestion.explanation}</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default QuizPlayer;
