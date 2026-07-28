import { React, LightDOMContainer } from '@exepad/sdk';

export default function HappyDoodsFooter({ className }) {
  return (
    <LightDOMContainer className={className}>
      <footer className="bg-[#ebe8e2] dark:bg-[#1c1c18] w-full py-12 mt-20">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 max-w-7xl mx-auto px-10">
          <div>
            <div className="text-xl font-serif font-bold text-[#47664b] dark:text-[#f4b400] mb-6">HappyDoods</div>
            <p className="text-[#47664b] opacity-70 mb-6 font-sans text-sm uppercase tracking-widest leading-loose">
              HappyDoods Farm<br />
              123 Pasture Lane<br />
              Green Valley, OR 97401
            </p>
            <div className="flex gap-4">
              <span className="material-symbols-outlined text-[#47664b]">potted_plant</span>
              <span className="material-symbols-outlined text-[#47664b]">egg</span>
              <span className="material-symbols-outlined text-[#47664b]">grass</span>
            </div>
          </div>
          <div className="flex flex-col gap-4 font-sans text-sm uppercase tracking-widest">
            <a className="text-[#47664b] opacity-70 hover:text-[#a03f29] transition-colors duration-200" href="#">Privacy Policy</a>
            <a className="text-[#47664b] opacity-70 hover:text-[#a03f29] transition-colors duration-200" href="#">Terms of Service</a>
            <a className="text-[#47664b] opacity-70 hover:text-[#a03f29] transition-colors duration-200" href="#">Wholesale Inquiries</a>
            <a className="text-[#47664b] opacity-70 hover:text-[#a03f29] transition-colors duration-200" href="#">Visit the Farm</a>
          </div>
          <div className="flex flex-col justify-between">
            <div>
              <h4 className="font-serif font-bold text-[#47664b] mb-4">Hours</h4>
              <p className="text-[#47664b] opacity-70 font-sans text-sm tracking-widest">MON - SAT: 8AM - 6PM</p>
              <p className="text-[#47664b] opacity-70 font-sans text-sm tracking-widest">SUN: 10AM - 4PM</p>
            </div>
            <div className="mt-8 md:mt-0">
              <p className="text-[#47664b] dark:text-[#f4b400] font-sans text-xs uppercase tracking-widest">
                &copy; 2024 HappyDoods Farm. Rooted in Nature.
              </p>
            </div>
          </div>
        </div>
      </footer>
    </LightDOMContainer>
  );
}
