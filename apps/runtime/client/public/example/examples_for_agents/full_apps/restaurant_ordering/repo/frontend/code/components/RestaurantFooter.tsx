import {
  React,
  Separator,
  Icons,
  cn,
} from "@exepad/sdk";

function RestaurantFooter() {
  return (
    <div className="bg-zinc-950 text-zinc-400">
      <div className="max-w-7xl mx-auto px-6 py-16">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
          {/* About */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Icons.UtensilsCrossed className="h-4 w-4" />
              </div>
              <span className="text-white font-bold text-xl">Savora Kitchen</span>
            </div>
            <p className="text-sm leading-relaxed text-zinc-400">
              Nestled in the heart of downtown, Savora Kitchen brings together the
              finest ingredients with time-honored culinary techniques. Every dish tells
              a story of passion, heritage, and the pursuit of flavor perfection. We
              source locally whenever possible and craft each plate with care.
            </p>
            <div className="flex gap-3 mt-6">
              <a href="#" className="w-9 h-9 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400 hover:bg-primary hover:text-white transition-colors">
                <Icons.Instagram className="h-4 w-4" />
              </a>
              <a href="#" className="w-9 h-9 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400 hover:bg-primary hover:text-white transition-colors">
                <Icons.Facebook className="h-4 w-4" />
              </a>
              <a href="#" className="w-9 h-9 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400 hover:bg-primary hover:text-white transition-colors">
                <Icons.Twitter className="h-4 w-4" />
              </a>
            </div>
          </div>

          {/* Hours */}
          <div>
            <h3 className="text-white font-bold text-lg mb-4">Opening Hours</h3>
            <ul className="space-y-3 text-sm">
              <li className="flex justify-between">
                <span>Monday - Thursday</span>
                <span className="text-white">11:00 AM - 10:00 PM</span>
              </li>
              <li className="flex justify-between">
                <span>Friday - Saturday</span>
                <span className="text-white">11:00 AM - 11:00 PM</span>
              </li>
              <li className="flex justify-between">
                <span>Sunday</span>
                <span className="text-white">10:00 AM - 9:00 PM</span>
              </li>
            </ul>
            <div className="mt-5 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800">
              <p className="text-xs text-zinc-500 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                Kitchen closes 30 minutes before closing time
              </p>
            </div>
          </div>

          {/* Contact */}
          <div>
            <h3 className="text-white font-bold text-lg mb-4">Contact</h3>
            <ul className="space-y-3 text-sm">
              <li className="flex items-start gap-3">
                <Icons.MapPin className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                <span>742 Evergreen Terrace<br />Downtown District, NY 10012</span>
              </li>
              <li className="flex items-center gap-3">
                <Icons.Phone className="h-4 w-4 text-primary shrink-0" />
                <span>(212) 555-0187</span>
              </li>
              <li className="flex items-center gap-3">
                <Icons.Mail className="h-4 w-4 text-primary shrink-0" />
                <span>hello@savorakitchen.com</span>
              </li>
            </ul>
          </div>
        </div>

        <Separator className="my-8 bg-zinc-800" />

        <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
          <p className="text-xs text-zinc-600">
            &copy; 2026 Savora Kitchen. All rights reserved.
          </p>
          <div className="flex gap-6 text-xs text-zinc-600">
            <a href="#" className="hover:text-white transition-colors">Privacy Policy</a>
            <a href="#" className="hover:text-white transition-colors">Terms of Service</a>
            <a href="#" className="hover:text-white transition-colors">Accessibility</a>
          </div>
        </div>
      </div>
    </div>
  );
}

export default RestaurantFooter;
