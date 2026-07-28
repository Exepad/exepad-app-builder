import {
  React,
  useModel,
  useNavigation,
  useCurrentUser,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Textarea,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Icons,
  cn,
  toast,
} from "@exepad/sdk";

function FeedbackForm() {
  const navigation = useNavigation();
  const currentUser = useCurrentUser();
  const model = useModel("submissions");

  const [rating, setRating] = React.useState(0);
  const [hoverRating, setHoverRating] = React.useState(0);
  const [category, setCategory] = React.useState("");
  const [liked, setLiked] = React.useState("");
  const [improve, setImprove] = React.useState("");
  const [recommend, setRecommend] = React.useState<boolean | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const validate = () => {
    const errs: Record<string, string> = {};
    if (rating === 0) errs.rating = "Please select a rating";
    if (!category) errs.category = "Please select a category";
    if (recommend === null) errs.recommend = "Please select yes or no";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    try {
      const data = JSON.stringify({ rating, category, liked, improve, recommend });
      if (model?.create) {
        await model.create({
          form_type: "feedback",
          data,
          status: "pending",
          submitted_by: currentUser?.email || "anonymous",
        });
      }
      toast({ title: "Feedback submitted!", description: "Thank you for your feedback." });
      setRating(0); setHoverRating(0); setCategory(""); setLiked(""); setImprove("");
      setRecommend(null); setErrors({});
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to submit", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const displayRating = hoverRating || rating;

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Icons.Star className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-xl">Feedback Form</CardTitle>
              <CardDescription>We value your input. Help us improve by sharing your experience.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Star Rating */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Overall Rating <span className="text-destructive">*</span></label>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setRating(star)}
                    onMouseEnter={() => setHoverRating(star)}
                    onMouseLeave={() => setHoverRating(0)}
                    className="p-1 transition-transform hover:scale-110"
                  >
                    <Icons.Star
                      className={cn(
                        "h-8 w-8 transition-colors",
                        star <= displayRating
                          ? "text-yellow-400 fill-yellow-400"
                          : "text-muted-foreground/30"
                      )}
                    />
                  </button>
                ))}
                {rating > 0 && (
                  <span className="ml-2 text-sm text-muted-foreground">
                    {rating === 1 && "Poor"}
                    {rating === 2 && "Fair"}
                    {rating === 3 && "Good"}
                    {rating === 4 && "Very Good"}
                    {rating === 5 && "Excellent"}
                  </span>
                )}
              </div>
              {errors.rating && <p className="text-xs text-destructive">{errors.rating}</p>}
            </div>

            {/* Category */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Category <span className="text-destructive">*</span></label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue placeholder="Select a category" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Product">Product</SelectItem>
                  <SelectItem value="Support">Support</SelectItem>
                  <SelectItem value="Feature">Feature Request</SelectItem>
                  <SelectItem value="Pricing">Pricing</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
              {errors.category && <p className="text-xs text-destructive">{errors.category}</p>}
            </div>

            {/* What did you like? */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">What did you like?</label>
              <Textarea
                placeholder="Tell us what you enjoyed..."
                value={liked}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setLiked(e.target.value)}
                rows={3}
              />
            </div>

            {/* What can we improve? */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">What can we improve?</label>
              <Textarea
                placeholder="Share your suggestions..."
                value={improve}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setImprove(e.target.value)}
                rows={3}
              />
            </div>

            {/* Would you recommend? */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Would you recommend us? <span className="text-destructive">*</span></label>
              <div className="flex gap-3">
                <Button
                  type="button"
                  variant={recommend === true ? "default" : "outline"}
                  onClick={() => setRecommend(true)}
                  className="flex-1"
                >
                  <Icons.ThumbsUp className="h-4 w-4 mr-2" />
                  Yes
                </Button>
                <Button
                  type="button"
                  variant={recommend === false ? "default" : "outline"}
                  onClick={() => setRecommend(false)}
                  className="flex-1"
                >
                  <Icons.ThumbsDown className="h-4 w-4 mr-2" />
                  No
                </Button>
              </div>
              {errors.recommend && <p className="text-xs text-destructive">{errors.recommend}</p>}
            </div>

            {/* Submit */}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Icons.Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Icons.Send className="h-4 w-4 mr-2" />}
              Submit Feedback
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default FeedbackForm;
