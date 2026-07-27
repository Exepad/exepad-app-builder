import {
  React,
  useAppState,
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselPrevious,
  CarouselNext,
  type CarouselApi,
  Avatar,
  AvatarImage,
  AvatarFallback,
  AspectRatio,
  Card,
  CardContent,
  Icons,
  cn,
} from "@exepad/sdk";

interface Testimonial {
  id: string;
  name: string;
  title: string;
  avatar: string;
  initials: string;
  quote: string;
  rating: number;
}

const TESTIMONIALS: Testimonial[] = [
  {
    id: "1",
    name: "Sarah Chen",
    title: "Product Manager at TechCo",
    avatar: "",
    initials: "SC",
    quote: "This platform completely transformed how we build internal tools. What used to take weeks now takes hours. The AI-powered generation is remarkably accurate.",
    rating: 5,
  },
  {
    id: "2",
    name: "James Rodriguez",
    title: "CTO at StartupXYZ",
    avatar: "",
    initials: "JR",
    quote: "We replaced three different tools with this single platform. The code quality it produces is production-ready and the customization options are endless.",
    rating: 5,
  },
  {
    id: "3",
    name: "Emily Watson",
    title: "Frontend Lead at DesignHub",
    avatar: "",
    initials: "EW",
    quote: "The component library is incredibly well-designed. Every element follows accessibility best practices and the theming system is flexible enough for any brand.",
    rating: 4,
  },
  {
    id: "4",
    name: "Michael Park",
    title: "Engineering Director at CloudScale",
    avatar: "",
    initials: "MP",
    quote: "Deployment is seamless. We went from prototype to production in a single afternoon. The infrastructure handling is completely abstracted away.",
    rating: 5,
  },
  {
    id: "5",
    name: "Lisa Thompson",
    title: "Solo Founder at AppForge",
    avatar: "",
    initials: "LT",
    quote: "As a non-technical founder, this tool gave me the power to bring my ideas to life without hiring a full development team. Absolutely game-changing.",
    rating: 5,
  },
  {
    id: "6",
    name: "David Kim",
    title: "DevOps Engineer at InfraNet",
    avatar: "",
    initials: "DK",
    quote: "The performance metrics are impressive. Pages load in under 200ms and the built-in optimization handles image compression and code splitting automatically.",
    rating: 4,
  },
  {
    id: "7",
    name: "Ana Martinez",
    title: "UX Researcher at UserFirst",
    avatar: "",
    initials: "AM",
    quote: "User testing showed a 40% improvement in task completion rates after we rebuilt our dashboard with this platform. The UI components are intuitive out of the box.",
    rating: 5,
  },
  {
    id: "8",
    name: "Robert Hughes",
    title: "VP of Engineering at DataFlow",
    avatar: "",
    initials: "RH",
    quote: "We evaluated dozens of tools before settling on this one. The combination of AI generation, component quality, and deployment simplicity is unmatched in the market.",
    rating: 5,
  },
];

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <Icons.Star
          key={i}
          className={cn(
            "h-4 w-4",
            i < rating
              ? "fill-yellow-400 text-yellow-400"
              : "fill-none text-muted-foreground/30"
          )}
        />
      ))}
    </div>
  );
}

function TestimonialCarousel() {
  const [currentSlide, setCurrentSlide] = useAppState<number>("currentSlide", 0);
  const [isHovered, setIsHovered] = useAppState<boolean>("isHovered", false);
  const [api, setApi] = React.useState<CarouselApi | null>(null);

  const slide = currentSlide ?? 0;
  const hovered = isHovered ?? false;

  React.useEffect(() => {
    if (!api) return;

    const onSelect = () => {
      setCurrentSlide(api.selectedScrollSnap());
    };

    api.on("select", onSelect);
    return () => {
      api.off("select", onSelect);
    };
  }, [api]);

  React.useEffect(() => {
    if (!api || hovered) return;

    const interval = setInterval(() => {
      api.scrollNext();
    }, 4000);

    return () => clearInterval(interval);
  }, [api, hovered]);

  const totalSlides = TESTIMONIALS.length;

  return (
    <div
      className="space-y-8"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="text-center space-y-2">
        <h2 className="text-3xl font-bold">What Our Customers Say</h2>
        <p className="text-muted-foreground max-w-2xl mx-auto">
          Join thousands of teams building better products faster.
        </p>
      </div>

      <Carousel
        setApi={setApi}
        opts={{ align: "start", loop: true }}
        className="w-full"
      >
        <CarouselContent className="-ml-4">
          {TESTIMONIALS.map((testimonial) => (
            <CarouselItem
              key={testimonial.id}
              className="pl-4 basis-full md:basis-1/2 lg:basis-1/3"
            >
              <AspectRatio ratio={4 / 3}>
                <Card className="h-full flex flex-col justify-between">
                  <CardContent className="pt-6 flex flex-col justify-between h-full">
                    <div className="space-y-4">
                      <StarRating rating={testimonial.rating} />
                      <blockquote className="text-sm leading-relaxed text-foreground/90">
                        &ldquo;{testimonial.quote}&rdquo;
                      </blockquote>
                    </div>
                    <div className="flex items-center gap-3 mt-4 pt-4 border-t">
                      <Avatar className="h-10 w-10">
                        {testimonial.avatar && (
                          <AvatarImage
                            src={testimonial.avatar}
                            alt={testimonial.name}
                          />
                        )}
                        <AvatarFallback className="text-xs font-semibold bg-primary/10 text-primary">
                          {testimonial.initials}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="text-sm font-semibold">{testimonial.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {testimonial.title}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </AspectRatio>
            </CarouselItem>
          ))}
        </CarouselContent>
        <CarouselPrevious className="-left-4 lg:-left-12" />
        <CarouselNext className="-right-4 lg:-right-12" />
      </Carousel>

      <div className="flex justify-center gap-2">
        {Array.from({ length: totalSlides }, (_, i) => (
          <button
            key={i}
            onClick={() => api?.scrollTo(i)}
            className={cn(
              "h-2 rounded-full transition-all duration-300",
              i === slide ? "w-6 bg-primary" : "w-2 bg-muted-foreground/30"
            )}
          />
        ))}
      </div>
    </div>
  );
}

export default TestimonialCarousel;
