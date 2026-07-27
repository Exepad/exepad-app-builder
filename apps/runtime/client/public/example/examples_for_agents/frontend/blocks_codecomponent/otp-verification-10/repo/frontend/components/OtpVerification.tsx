import {
  React,
  useAppState,
  useHandler,
  toast,
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  InputOTPSeparator,
  Button,
  Alert,
  AlertTitle,
  AlertDescription,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Motion,
  Icons,
  cn,
} from "@exepad/sdk";

type VerificationStatus = "idle" | "verifying" | "success" | "error";

const CORRECT_OTP = "123456";
const COUNTDOWN_SECONDS = 60;

function OtpVerification() {
  const [otpValue, setOtpValue] = useAppState<string>("otpValue", "");
  const [status, setStatus] = useAppState<VerificationStatus>("otpStatus", "idle");
  const [countdown, setCountdown] = useAppState<number>("otpCountdown", COUNTDOWN_SECONDS);
  const [canResend, setCanResend] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  // Countdown timer
  React.useEffect(() => {
    if (countdown <= 0) {
      setCanResend(true);
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    setCanResend(false);
    timerRef.current = setInterval(() => {
      setCountdown((prev: number) => {
        if (prev <= 1) {
          setCanResend(true);
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [countdown === COUNTDOWN_SECONDS]);

  // Simulate verification via useHandler
  const verify = useHandler("verifyOtp");

  const handleVerify = async () => {
    if ((otpValue || "").length !== 6) {
      toast("Please enter all 6 digits");
      return;
    }
    setStatus("verifying");

    // Simulate async verification
    await new Promise((resolve) => setTimeout(resolve, 1500));

    if (otpValue === CORRECT_OTP) {
      setStatus("success");
      toast("Verification successful!");
    } else {
      setStatus("error");
      toast("Invalid code. Please try again.");
    }
  };

  const handleResend = () => {
    setOtpValue("");
    setStatus("idle");
    setCountdown(COUNTDOWN_SECONDS);
    setCanResend(false);
    toast("A new code has been sent to your device.");
  };

  const handleReset = () => {
    setOtpValue("");
    setStatus("idle");
  };

  const formatTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex items-center justify-center min-h-[500px] p-4">
      <Motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-md"
      >
        <Card>
          <CardHeader className="text-center">
            <Motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
            >
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                {status === "success" ? (
                  <Icons.CheckCircle className="h-7 w-7 text-green-600 dark:text-green-400" />
                ) : status === "error" ? (
                  <Icons.XCircle className="h-7 w-7 text-destructive" />
                ) : (
                  <Icons.Shield className="h-7 w-7 text-primary" />
                )}
              </div>
              <CardTitle className="text-xl">Verify Your Identity</CardTitle>
              <CardDescription>
                Enter the 6-digit code sent to your device.
                <br />
                <span className="text-xs text-muted-foreground">
                  (Demo: use 123456 to succeed)
                </span>
              </CardDescription>
            </Motion.div>
          </CardHeader>

          <CardContent className="space-y-6">
            {/* OTP Input */}
            <Motion.div
              key={status === "success" ? "done" : "input"}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="flex justify-center"
            >
              <InputOTP
                maxLength={6}
                value={otpValue || ""}
                onChange={(value: string) => {
                  if (status !== "verifying") {
                    setOtpValue(value);
                    if (status !== "idle") setStatus("idle");
                  }
                }}
                disabled={status === "verifying" || status === "success"}
              >
                <InputOTPGroup>
                  <InputOTPSlot index={0} />
                  <InputOTPSlot index={1} />
                  <InputOTPSlot index={2} />
                </InputOTPGroup>
                <InputOTPSeparator />
                <InputOTPGroup>
                  <InputOTPSlot index={3} />
                  <InputOTPSlot index={4} />
                  <InputOTPSlot index={5} />
                </InputOTPGroup>
              </InputOTP>
            </Motion.div>

            {/* Status Alert */}
            {status === "success" && (
              <Motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                transition={{ duration: 0.3 }}
              >
                <Alert className="border-green-500 bg-green-50 dark:bg-green-950/30">
                  <Icons.CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                  <AlertTitle className="text-green-800 dark:text-green-300">
                    Verification Complete
                  </AlertTitle>
                  <AlertDescription className="text-green-700 dark:text-green-400">
                    Your identity has been verified successfully.
                  </AlertDescription>
                </Alert>
              </Motion.div>
            )}

            {status === "error" && (
              <Motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                transition={{ duration: 0.3 }}
              >
                <Alert variant="destructive">
                  <Icons.XCircle className="h-4 w-4" />
                  <AlertTitle>Invalid Code</AlertTitle>
                  <AlertDescription>
                    The code you entered is incorrect. Please try again.
                  </AlertDescription>
                </Alert>
              </Motion.div>
            )}

            {/* Countdown Timer */}
            <div className="text-center text-sm text-muted-foreground">
              {canResend ? (
                <span>Didn&apos;t receive the code?</span>
              ) : (
                <span>Resend code in {formatTime(countdown || 0)}</span>
              )}
            </div>
          </CardContent>

          <CardFooter className="flex flex-col gap-3">
            {status === "success" ? (
              <Button className="w-full" onClick={handleReset}>
                <Icons.ArrowRight className="mr-2 h-4 w-4" />
                Continue
              </Button>
            ) : (
              <Button
                className="w-full"
                onClick={handleVerify}
                disabled={status === "verifying" || (otpValue || "").length !== 6}
              >
                {status === "verifying" ? (
                  <>
                    <Icons.Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  <>
                    <Icons.Shield className="mr-2 h-4 w-4" />
                    Verify Code
                  </>
                )}
              </Button>
            )}
            <Button
              variant="ghost"
              className="w-full"
              onClick={handleResend}
              disabled={!canResend || status === "verifying"}
            >
              <Icons.RefreshCw className="mr-2 h-4 w-4" />
              Resend Code
            </Button>
          </CardFooter>
        </Card>
      </Motion.div>
    </div>
  );
}

export default OtpVerification;
