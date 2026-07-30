import {
  React,
  useModel,
  toast,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Input,
  Textarea,
  Separator,
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Icons,
  cn,
} from "@exepad/sdk";

const { useState } = React;

const DEMO_REVIEWS = [
  { id: "rv1", rating: 5, comment: "The truffle mushroom risotto was absolutely divine. Creamy, earthy, and perfectly seasoned. This is easily one of the best Italian restaurants in the city.", customer_name: "Sarah Mitchell", created_at: "2026-03-20T18:30:00Z" },
  { id: "rv2", rating: 5, comment: "Best branzino I have had outside of the Mediterranean. The herbs and lemon were perfection. Our server was incredibly knowledgeable about the wine pairings.", customer_name: "James Chen", created_at: "2026-03-18T20:15:00Z" },
  { id: "rv3", rating: 4, comment: "Incredible pasta selection. The cacio e pepe was simple perfection and the tiramisu is a must-order. Only wish the wait time was a bit shorter on weekends.", customer_name: "Maria Rodriguez", created_at: "2026-03-15T19:00:00Z" },
  { id: "rv4", rating: 5, comment: "We celebrated our anniversary here and it was magical. The osso buco was tender and flavorful. The staff made the evening truly special with a complimentary dessert.", customer_name: "David Park", created_at: "2026-03-12T21:00:00Z" },
  { id: "rv5", rating: 4, comment: "The Aperol Spritz was perfectly made and the calamari appetizer was crispy and light. Great atmosphere for after-work drinks with colleagues. Will definitely return.", customer_name: "Emily Watson", created_at: "2026-03-10T17:45:00Z" },
  { id: "rv6", rating: 5, comment: "Hands down the best lobster ravioli I have ever tasted. The saffron cream sauce was incredible. Chef Marco clearly puts his heart into every dish.", customer_name: "Robert Kim", created_at: "2026-03-08T19:30:00Z" },
  { id: "rv7", rating: 3, comment: "Food was good but the restaurant was quite loud on a Friday evening. The chocolate lava cake was outstanding though. Would recommend coming on a weeknight.", customer_name: "Amanda Foster", created_at: "2026-03-05T20:00:00Z" },
  { id: "rv8", rating: 5, comment: "Ordered delivery for a dinner party and everything arrived hot and perfectly packaged. The pappardelle bolognese was rich and hearty. Our guests were so impressed.", customer_name: "Michael Torres", created_at: "2026-03-02T18:00:00Z" },
  { id: "rv9", rating: 4, comment: "Love the warm ambiance and the attentive service. The burrata caprese was fresh and creamy. I appreciated the generous portion sizes. A solid neighborhood gem.", customer_name: "Lisa Chang", created_at: "2026-02-28T19:15:00Z" },
  { id: "rv10", rating: 5, comment: "We have been coming to Savora every month for over two years now. Consistency is their superpower. The lamb chops are always cooked to perfection.", customer_name: "Thomas Wright", created_at: "2026-02-25T20:30:00Z" },
  { id: "rv11", rating: 4, comment: "The espresso martini was one of the best I have had. Strong, smooth, and not too sweet. The arrabbiata penne brought real heat. Great energy in the restaurant.", customer_name: "Nina Patel", created_at: "2026-02-22T21:00:00Z" },
  { id: "rv12", rating: 5, comment: "Brought my parents here for their wedding anniversary. Dad said the chicken parmigiana reminded him of his mother cooking back in Italy. Highest compliment possible.", customer_name: "Sofia Reyes", created_at: "2026-02-18T19:00:00Z" },
];

const RATING_DIST = [
  { stars: 5, pct: 65 },
  { stars: 4, pct: 20 },
  { stars: 3, pct: 8 },
  { stars: 2, pct: 4 },
  { stars: 1, pct: 3 },
];

function StarRating({
  rating,
  size = "sm",
  interactive = false,
  onChange,
}: {
  rating: number;
  size?: "sm" | "md" | "lg";
  interactive?: boolean;
  onChange?: (star: number) => void;
}) {
  const sizeClass = size === "lg" ? "h-6 w-6" : size === "md" ? "h-5 w-5" : "h-4 w-4";
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <Icons.Star
          key={star}
          className={cn(
            sizeClass,
            star <= rating ? "fill-primary text-primary" : "fill-muted text-muted",
            interactive && "cursor-pointer hover:scale-110 transition-transform"
          )}
          onClick={interactive && onChange ? () => onChange(star) : undefined}
        />
      ))}
    </div>
  );
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function ReviewsPage() {
  const reviewsModel = useModel("reviews");
  const reviews = (reviewsModel?.data as any[] | null) ?? DEMO_REVIEWS;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [newRating, setNewRating] = useState(0);
  const [newComment, setNewComment] = useState("");
  const [newName, setNewName] = useState("");

  const avgRating = 4.7;
  const totalReviews = 234;

  const handleSubmitReview = () => {
    if (newRating === 0 || !newComment.trim() || !newName.trim()) {
      toast("Please provide a rating, your name, and a comment.");
      return;
    }
    toast("Review submitted! Thank you for your feedback.");
    setDialogOpen(false);
    setNewRating(0);
    setNewComment("");
    setNewName("");
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-12 space-y-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Guest Reviews</h1>
          <p className="text-muted-foreground mt-1">See what our guests have to say about Savora Kitchen.</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Icons.Pencil className="mr-2 h-4 w-4" />
              Write a Review
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Write a Review</DialogTitle>
            </DialogHeader>

            <div className="space-y-5 py-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Your Rating</label>
                <StarRating rating={newRating} size="lg" interactive onChange={setNewRating} />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Your Name</label>
                <Input
                  placeholder="Enter your name"
                  value={newName}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Your Review</label>
                <Textarea
                  placeholder="Tell us about your experience..."
                  value={newComment}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNewComment(e.target.value)}
                  rows={4}
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleSubmitReview}>Submit Review</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Overall Rating Card */}
      <Card>
        <CardContent className="p-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="flex flex-col items-center justify-center">
              <div className="text-6xl font-extrabold">{avgRating}</div>
              <StarRating rating={Math.round(avgRating)} size="lg" />
              <p className="text-sm text-muted-foreground mt-2">Based on {totalReviews} reviews</p>
            </div>
            <div className="space-y-3">
              {RATING_DIST.map((r) => (
                <div key={r.stars} className="flex items-center gap-3">
                  <span className="text-sm font-medium text-muted-foreground w-12">{r.stars} star</span>
                  <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all"
                      style={{ width: `${r.pct}%` }}
                    />
                  </div>
                  <span className="text-sm text-muted-foreground w-10 text-right">{r.pct}%</span>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Reviews List */}
      <div className="space-y-4">
        {DEMO_REVIEWS.map((review) => (
          <Card key={review.id}>
            <CardContent className="p-6">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-bold text-sm">
                    {review.customer_name.split(" ").map((n) => n[0]).join("")}
                  </div>
                  <div>
                    <p className="font-semibold text-sm">{review.customer_name}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(review.created_at)}</p>
                  </div>
                </div>
                <StarRating rating={review.rating} />
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">{review.comment}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default ReviewsPage;
