import {
  React,
  useModel,
  useNavigation,
  Card,
  CardContent,
  Button,
  Icons,
  cn,
} from "@exepad/sdk";

const DEMO_FEATURED = [
  { id: "f1", name: "Truffle Mushroom Risotto", price: 24.0, description: "Arborio rice slow-cooked with porcini mushrooms, finished with black truffle oil and aged Parmigiano-Reggiano.", category: "mains" },
  { id: "f2", name: "Grilled Mediterranean Branzino", price: 32.0, description: "Whole sea bass grilled with lemon, capers, and fresh herbs, served on a bed of roasted vegetables.", category: "seafood" },
  { id: "f3", name: "Tiramisu Classico", price: 12.0, description: "Layers of espresso-soaked ladyfingers, mascarpone cream, and cocoa. Our signature recipe since 2011.", category: "desserts" },
];

const DEMO_TESTIMONIALS = [
  { id: "t1", name: "Sarah Mitchell", rating: 5, quote: "The truffle risotto was absolutely divine. Every bite was an experience. This has become our go-to date night spot." },
  { id: "t2", name: "James Chen", rating: 5, quote: "Best branzino I have had outside of Greece. The ambiance is warm and inviting, and the staff made us feel like family." },
  { id: "t3", name: "Maria Rodriguez", rating: 4, quote: "Incredible pasta selection and the tiramisu is a must. We have been coming here for years and it never disappoints." },
];

const STATS = [
  { value: "Est. 2011", label: "Year Founded" },
  { value: "50+", label: "Signature Dishes" },
  { value: "10K+", label: "Happy Customers" },
  { value: "4.7", label: "Average Rating" },
];

const WARM_COLORS = ["bg-orange-200", "bg-sky-200", "bg-pink-200"];

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <Icons.Star
          key={star}
          className={cn(
            "h-4 w-4",
            star <= rating
              ? "fill-primary text-primary"
              : "fill-muted text-muted"
          )}
        />
      ))}
    </div>
  );
}

function RestaurantHome() {
  const navigation = useNavigation();
  const featuredModel = useModel("menu_items");
  const featured = (featuredModel?.data as any[] | null) ?? DEMO_FEATURED;

  return (
    <div className="w-full">
      {/* Hero Section */}
      <Card className="rounded-none border-0 overflow-hidden">
        <div
          className="relative min-h-[550px] flex items-center"
          style={{
            background: "linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--primary) / 0.8) 50%, #c2410c 100%)",
          }}
        >
          <div className="relative z-10 max-w-7xl mx-auto px-6 py-20 w-full">
            <div className="max-w-2xl">
              <span className="inline-block px-4 py-1.5 bg-white/20 backdrop-blur-sm text-white text-xs font-semibold uppercase tracking-widest rounded-full mb-6">
                Est. 2011 &bull; Downtown NY
              </span>
              <h1 className="text-5xl md:text-6xl font-extrabold text-white leading-tight mb-6">
                Authentic Flavors,{" "}
                <span className="text-orange-200">Crafted with Passion</span>
              </h1>
              <p className="text-lg text-white/80 leading-relaxed mb-10 max-w-lg">
                From our kitchen to your table, every dish at Savora is a celebration
                of fresh ingredients, bold spices, and culinary artistry passed down
                through generations.
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <Button
                  size="lg"
                  variant="secondary"
                  onClick={() => navigation.navigate("/menu")}
                  className="font-bold text-primary"
                >
                  View Menu
                  <Icons.ArrowRight className="ml-2 h-4 w-4" />
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => navigation.navigate("/reservations")}
                  className="font-bold border-white text-white hover:bg-white/10 bg-transparent"
                >
                  Book a Table
                </Button>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Featured Dishes */}
      <div className="py-20 max-w-7xl mx-auto px-6">
        <div className="text-center mb-14">
          <p className="text-primary text-sm font-semibold uppercase tracking-widest">Our Specials</p>
          <h2 className="text-3xl font-extrabold mt-2">Featured Dishes</h2>
          <p className="text-muted-foreground mt-3 max-w-lg mx-auto">
            Hand-picked favorites from our chef, crafted with seasonal ingredients at their peak.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {DEMO_FEATURED.map((dish, i) => (
            <Card key={dish.id} className="overflow-hidden group cursor-pointer hover:shadow-lg transition-shadow">
              <div className={cn("h-48 flex items-center justify-center", WARM_COLORS[i % 3])}>
                <Icons.ChefHat className="h-16 w-16 text-primary/20" />
              </div>
              <CardContent className="p-6">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="text-lg font-bold">{dish.name}</h3>
                  <span className="text-primary font-bold text-lg">${dish.price.toFixed(2)}</span>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">{dish.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="text-center mt-10">
          <Button variant="link" onClick={() => navigation.navigate("/menu")} className="text-primary font-semibold">
            View Full Menu <Icons.ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* About / Stats */}
      <div className="py-20 bg-muted/50">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-16 items-center">
            <div>
              <p className="text-primary text-sm font-semibold uppercase tracking-widest">Our Story</p>
              <h2 className="text-3xl font-extrabold mt-2 mb-6">A Legacy of Flavor Since 2011</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                What started as a small family trattoria has grown into one of
                downtown's most beloved dining destinations. Chef Marco Savora brought
                his grandmother's recipes from Naples and reimagined them with locally
                sourced, seasonal ingredients.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Today, our kitchen blends Mediterranean tradition with modern culinary
                innovation. We believe great food starts with great ingredients, honest
                preparation, and a deep respect for the craft.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {STATS.map((stat) => (
                <Card key={stat.label} className="text-center p-6">
                  <div className="text-2xl font-extrabold text-primary">{stat.value}</div>
                  <div className="text-sm text-muted-foreground mt-1">{stat.label}</div>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Testimonials */}
      <div className="py-20 max-w-7xl mx-auto px-6">
        <div className="text-center mb-14">
          <p className="text-primary text-sm font-semibold uppercase tracking-widest">Testimonials</p>
          <h2 className="text-3xl font-extrabold mt-2">What Our Guests Say</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {DEMO_TESTIMONIALS.map((t) => (
            <Card key={t.id} className="p-8">
              <StarRating rating={t.rating} />
              <p className="text-muted-foreground leading-relaxed mt-4 mb-6 italic">
                "{t.quote}"
              </p>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-bold text-sm">
                  {t.name.split(" ").map((n) => n[0]).join("")}
                </div>
                <span className="text-sm font-semibold">{t.name}</span>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* CTA Banner */}
      <Card className="rounded-none border-0">
        <div
          className="py-16"
          style={{
            background: "linear-gradient(135deg, hsl(var(--primary)) 0%, #c2410c 100%)",
          }}
        >
          <div className="max-w-4xl mx-auto px-6 text-center">
            <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-4">
              Ready to Experience Savora?
            </h2>
            <p className="text-white/80 text-lg mb-8">
              Reserve your table today or order online for pickup and delivery.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button
                size="lg"
                variant="secondary"
                onClick={() => navigation.navigate("/reservations")}
                className="font-bold text-primary"
              >
                Reserve a Table
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => navigation.navigate("/order")}
                className="font-bold border-white text-white hover:bg-white/10 bg-transparent"
              >
                Order Online
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

export default RestaurantHome;
