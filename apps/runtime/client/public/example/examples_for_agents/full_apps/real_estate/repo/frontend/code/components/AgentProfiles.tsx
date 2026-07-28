import {
  React,
  useNavigation,
  useModel,
  Button,
  Card,
  CardContent,
  Input,
  Badge,
  Avatar,
  AvatarFallback,
  Icons,
  cn,
} from "@exepad/sdk";

interface Agent {
  id: string;
  name: string;
  email: string;
  phone: string;
  bio: string;
  photo_url: string | null;
  license_number: string;
  specializations: string;
  listings_count?: number;
  rating?: number;
}

const DEMO_AGENTS: Agent[] = [
  {
    id: "1",
    name: "Sarah Mitchell",
    email: "sarah.mitchell@nestfinder.com",
    phone: "(206) 555-0142",
    bio: "With over 15 years of experience in the Seattle real estate market, Sarah specializes in luxury waterfront properties and historic homes. She has consistently ranked in the top 1% of agents citywide.",
    photo_url: null,
    license_number: "RE-29841",
    specializations: '["Luxury Homes", "Waterfront", "Historic Properties"]',
    listings_count: 42,
    rating: 4.9,
  },
  {
    id: "2",
    name: "Marcus Chen",
    email: "marcus.chen@nestfinder.com",
    phone: "(415) 555-0387",
    bio: "Marcus brings a tech-savvy approach to San Francisco real estate. His expertise in the SOMA and Mission districts has helped hundreds of first-time buyers find their perfect urban homes.",
    photo_url: null,
    license_number: "RE-31205",
    specializations: '["First-Time Buyers", "Condos", "Investment Properties"]',
    listings_count: 38,
    rating: 4.8,
  },
  {
    id: "3",
    name: "Elena Rodriguez",
    email: "elena.rodriguez@nestfinder.com",
    phone: "(503) 555-0219",
    bio: "Elena's deep knowledge of Portland's diverse neighborhoods makes her the go-to agent for families and creative professionals looking for character-filled homes with that Portland charm.",
    photo_url: null,
    license_number: "RE-28750",
    specializations: '["Family Homes", "Bungalows", "Eco-Friendly"]',
    listings_count: 35,
    rating: 4.9,
  },
  {
    id: "4",
    name: "James Okafor",
    email: "james.okafor@nestfinder.com",
    phone: "(303) 555-0456",
    bio: "James is a Boulder native with unmatched knowledge of the Colorado Front Range. He specializes in mountain-view properties and sustainable homes for the active outdoor lifestyle.",
    photo_url: null,
    license_number: "RE-33102",
    specializations: '["Mountain Properties", "Sustainable Homes", "Land"]',
    listings_count: 29,
    rating: 4.7,
  },
  {
    id: "5",
    name: "Priya Patel",
    email: "priya.patel@nestfinder.com",
    phone: "(206) 555-0573",
    bio: "Priya's background in architecture gives her clients a unique edge when evaluating properties. She serves the greater Seattle area with a focus on new construction and modern design.",
    photo_url: null,
    license_number: "RE-34891",
    specializations: '["New Construction", "Modern Design", "Condos"]',
    listings_count: 31,
    rating: 4.8,
  },
  {
    id: "6",
    name: "David Kim",
    email: "david.kim@nestfinder.com",
    phone: "(415) 555-0691",
    bio: "David has earned a reputation as San Francisco's top negotiator. His clients benefit from his strategic approach to competitive bidding situations and his extensive network of industry contacts.",
    photo_url: null,
    license_number: "RE-27643",
    specializations: '["Luxury Condos", "Negotiation", "Relocation"]',
    listings_count: 45,
    rating: 4.9,
  },
  {
    id: "7",
    name: "Amanda Foster",
    email: "amanda.foster@nestfinder.com",
    phone: "(503) 555-0825",
    bio: "Amanda brings warmth and professionalism to every transaction. With deep roots in Portland's Alberta Arts District and surrounding neighborhoods, she helps creative professionals find inspiring spaces.",
    photo_url: null,
    license_number: "RE-30567",
    specializations: '["Arts District", "Townhomes", "First-Time Buyers"]',
    listings_count: 27,
    rating: 4.6,
  },
  {
    id: "8",
    name: "Robert Thompson",
    email: "robert.thompson@nestfinder.com",
    phone: "(303) 555-0934",
    bio: "Robert is a commercial and residential specialist serving the Denver metro area. His dual expertise makes him the ideal partner for investors and homeowners looking to build their real estate portfolio.",
    photo_url: null,
    license_number: "RE-26198",
    specializations: '["Investment", "Commercial", "Multi-Family"]',
    listings_count: 53,
    rating: 4.7,
  },
];

function parseSpecializations(raw: string | null): string[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function renderStars(rating: number) {
  const full = Math.floor(rating);
  const hasHalf = rating - full >= 0.5;
  const stars: React.ReactNode[] = [];
  for (let i = 0; i < full; i++) {
    stars.push(<Icons.Star key={`f-${i}`} className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />);
  }
  if (hasHalf) {
    stars.push(<Icons.StarHalf key="h" className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />);
  }
  return stars;
}

function AgentProfiles() {
  const navigation = useNavigation();
  const { data: modelAgents } = useModel<Agent>("agents", { limit: 50 });

  const [searchQuery, setSearchQuery] = React.useState("");

  const agents = modelAgents && modelAgents.length > 0 ? modelAgents : DEMO_AGENTS;

  const filtered = agents.filter((agent) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const specs = parseSpecializations(agent.specializations).join(" ").toLowerCase();
    return (
      agent.name.toLowerCase().includes(q) ||
      specs.includes(q) ||
      agent.bio.toLowerCase().includes(q)
    );
  });

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Our Agents</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Connect with experienced professionals in your area
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Icons.Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search agents or specializations..."
            value={searchQuery}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
            className="pl-9 h-10"
          />
        </div>
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-16">
          <Icons.UserX className="h-12 w-12 text-muted-foreground/40 mx-auto mb-3" />
          <h3 className="font-semibold text-lg">No agents found</h3>
          <p className="text-sm text-muted-foreground mt-1">Try a different search term</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => setSearchQuery("")}>
            Clear Search
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {filtered.map((agent) => {
          const specs = parseSpecializations(agent.specializations);
          const initials = agent.name
            .split(" ")
            .map((n) => n[0])
            .join("")
            .toUpperCase();
          const rating = agent.rating ?? 4.5;
          const listings = agent.listings_count ?? 0;

          return (
            <Card key={agent.id} className="property-card overflow-hidden group">
              {/* Top accent bar */}
              <div className="h-20 bg-gradient-to-r from-primary/20 to-accent/40 relative">
                <Avatar className="absolute -bottom-8 left-4 h-16 w-16 border-4 border-background shadow-md">
                  <AvatarFallback className="bg-primary text-primary-foreground text-lg font-bold">
                    {initials}
                  </AvatarFallback>
                </Avatar>
              </div>

              <CardContent className="pt-12 pb-5 px-4">
                <h3 className="font-semibold text-base">{agent.name}</h3>
                <p className="text-xs text-muted-foreground">License #{agent.license_number}</p>

                {/* Rating & Listings */}
                <div className="flex items-center gap-3 mt-2">
                  <div className="flex items-center gap-0.5">
                    {renderStars(rating)}
                    <span className="text-xs font-medium ml-1">{rating}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {listings} listings
                  </span>
                </div>

                {/* Specializations */}
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {specs.slice(0, 3).map((spec) => (
                    <Badge key={spec} variant="secondary" className="text-[10px] px-2 py-0.5">
                      {spec}
                    </Badge>
                  ))}
                </div>

                {/* Bio */}
                <p className="text-xs text-muted-foreground mt-3 line-clamp-3 leading-relaxed">
                  {agent.bio}
                </p>

                {/* Actions */}
                <div className="flex items-center gap-2 mt-4">
                  <Button size="sm" className="flex-1 gap-1.5 text-xs h-8">
                    <Icons.Phone className="h-3 w-3" />
                    Contact
                  </Button>
                  <Button variant="outline" size="sm" className="flex-1 gap-1.5 text-xs h-8" onClick={() => navigation.navigate(`/agents`)}>
                    <Icons.User className="h-3 w-3" />
                    Profile
                  </Button>
                </div>

                {/* Contact Info */}
                <div className="mt-3 pt-3 border-t border-border space-y-1">
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                    <Icons.Phone className="h-3 w-3" /> {agent.phone}
                  </p>
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                    <Icons.Mail className="h-3 w-3" /> {agent.email}
                  </p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

export default AgentProfiles;
