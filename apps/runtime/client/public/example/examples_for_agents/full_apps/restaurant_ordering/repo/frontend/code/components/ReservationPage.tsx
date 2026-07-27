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
  Icons,
  cn,
} from "@exepad/sdk";

const { useState } = React;

const DEMO_RESERVATIONS = [
  { id: "r1", date: "2026-03-28", time_slot: "7:00 PM", party_size: 4, customer_name: "John Doe", customer_phone: "555-0101", status: "confirmed", notes: null },
];

const TIME_SLOTS = [
  "11:00 AM", "11:30 AM", "12:00 PM", "12:30 PM",
  "1:00 PM", "1:30 PM", "2:00 PM", "2:30 PM",
  "3:00 PM", "3:30 PM", "4:00 PM", "4:30 PM",
  "5:00 PM", "5:30 PM", "6:00 PM", "6:30 PM",
  "7:00 PM", "7:30 PM", "8:00 PM", "8:30 PM", "9:00 PM",
];

const PARTY_SIZES = Array.from({ length: 12 }, (_, i) => i + 1);

interface BookedDetails {
  date: string;
  time: string;
  partySize: number;
  name: string;
}

function ReservationPage() {
  const reservationsModel = useModel("reservations");
  const reservations = (reservationsModel?.data as any[] | null) ?? DEMO_RESERVATIONS;

  const [selectedDate, setSelectedDate] = useState("");
  const [selectedSlot, setSelectedSlot] = useState("");
  const [partySize, setPartySize] = useState(2);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [specialRequests, setSpecialRequests] = useState("");
  const [isBooked, setIsBooked] = useState(false);
  const [bookedDetails, setBookedDetails] = useState<BookedDetails | null>(null);

  const today = new Date().toISOString().split("T")[0];

  const handleBook = () => {
    if (!selectedDate || !selectedSlot || !name || !phone) {
      toast("Please fill in date, time, name, and phone number.");
      return;
    }
    const details = { date: selectedDate, time: selectedSlot, partySize, name };
    setBookedDetails(details);
    setIsBooked(true);
    toast(`Table reserved for ${partySize} on ${selectedDate} at ${selectedSlot}`);
  };

  if (isBooked && bookedDetails) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-6">
        <Card className="max-w-md w-full text-center p-8">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6">
            <Icons.Check className="h-8 w-8 text-green-600" />
          </div>
          <h2 className="text-2xl font-extrabold mb-4">Reservation Confirmed!</h2>

          <Card className="text-left mb-6">
            <CardContent className="p-4 space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Name</span>
                <span className="font-semibold">{bookedDetails.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Date</span>
                <span className="font-semibold">{bookedDetails.date}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Time</span>
                <span className="font-semibold">{bookedDetails.time}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Party Size</span>
                <span className="font-semibold">{bookedDetails.partySize} guests</span>
              </div>
            </CardContent>
          </Card>

          <p className="text-sm text-muted-foreground mb-6">
            A confirmation will be sent to your phone. Please arrive 10 minutes early.
          </p>
          <Button
            onClick={() => {
              setIsBooked(false);
              setSelectedDate("");
              setSelectedSlot("");
              setName("");
              setPhone("");
              setEmail("");
              setSpecialRequests("");
            }}
          >
            Make Another Reservation
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-12 space-y-10">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Reserve a Table</h1>
        <p className="text-muted-foreground mt-1">Book your dining experience at Savora Kitchen.</p>
      </div>

      {/* Step 1: Date */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-3 text-base">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-primary text-primary-foreground text-xs font-bold">1</span>
            Select a Date
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Input
            type="date"
            min={today}
            value={selectedDate}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSelectedDate(e.target.value)}
            className="max-w-xs"
          />
        </CardContent>
      </Card>

      {/* Step 2: Time */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-3 text-base">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-primary text-primary-foreground text-xs font-bold">2</span>
            Choose a Time
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 gap-2">
            {TIME_SLOTS.map((slot) => (
              <Button
                key={slot}
                variant={selectedSlot === slot ? "default" : "outline"}
                size="sm"
                className="text-xs"
                onClick={() => setSelectedSlot(slot)}
              >
                {slot}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Step 3: Party Size */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-3 text-base">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-primary text-primary-foreground text-xs font-bold">3</span>
            Party Size
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {PARTY_SIZES.map((size) => (
              <Button
                key={size}
                variant={partySize === size ? "default" : "outline"}
                size="icon"
                className="w-11 h-11"
                onClick={() => setPartySize(size)}
              >
                {size}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Step 4: Contact */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-3 text-base">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-primary text-primary-foreground text-xs font-bold">4</span>
            Your Details
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Name *</label>
              <Input
                placeholder="Your full name"
                value={name}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Phone *</label>
              <Input
                type="tel"
                placeholder="(555) 000-0000"
                value={phone}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPhone(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Email</label>
              <Input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
              />
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Special Requests</label>
              <Textarea
                placeholder="Birthday celebration, high chair needed, dietary restrictions..."
                value={specialRequests}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setSpecialRequests(e.target.value)}
                rows={3}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Book Button */}
      <div>
        <Button size="lg" onClick={handleBook}>
          <Icons.CalendarCheck className="mr-2 h-4 w-4" />
          Book Table
        </Button>
        <p className="text-xs text-muted-foreground mt-3">
          You will receive a confirmation via phone. Cancellations must be made at least 2 hours in advance.
        </p>
      </div>
    </div>
  );
}

export default ReservationPage;
