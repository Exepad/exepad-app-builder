import { React, navigate, LightDOMContainer } from '@exepad/sdk';

const { useMemo } = React;

export default function HappyDoodsHeader({ className }) {
  const { slug, links } = useMemo(() => {
    const path = typeof window !== 'undefined' ? window.location.pathname : '/';
    const s = path.replace(/^\/[^\/]+\/[^\/]+\/[^\/]+\/[^\/]+/, '') || '/';
    return {
      slug: s,
      links: [
        { label: 'Home', href: '/' },
        { label: 'Products', href: '/products' },
        { label: 'About Us', href: '/about' },
        { label: 'Contact', href: '/contact' },
      ],
    };
  }, []);

  const handleClick = (e, href) => {
    e.preventDefault();
    navigate(href);
  };

  return (
    <LightDOMContainer className={className}>
      <div className="w-full bg-[#fcf9f3]/80 backdrop-blur-md shadow-sm">
        <div className="flex justify-between items-center max-w-7xl mx-auto px-8 py-4">
          <div className="text-2xl font-black text-[#7a5900] dark:text-[#f4b400] font-serif">HappyDoods</div>
          <div className="hidden md:flex items-center space-x-10 font-serif text-lg tracking-tight">
            {links.map((l) => {
              const active = slug === l.href;
              const cls = active
                ? 'text-[#7a5900] dark:text-[#f4b400] font-bold border-b-2 border-[#7a5900] dark:border-[#f4b400] pb-1 transition-transform scale-95 active:scale-100'
                : 'text-[#47664b] dark:text-[#ebe8e2] hover:text-[#7a5900] transition-colors hover:opacity-80';
              return (
                <a
                  key={l.href}
                  className={`${cls} font-serif text-lg tracking-tight`}
                  href={l.href}
                  onClick={(e) => handleClick(e, l.href)}
                >
                  {l.label}
                </a>
              );
            })}
          </div>
          <button className="bg-primary text-on-primary px-8 py-3 rounded-full font-bold hover:opacity-80 transition-opacity duration-300 scale-95 active:scale-100">
            Order Now
          </button>
        </div>
      </div>
    </LightDOMContainer>
  );
}
