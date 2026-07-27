import { React, ExepadImage } from "@exepad/sdk";

const TESTIMONIALS = [
  {
    quote: "Transformed our infrastructure.",
    author: "Alex Doe",
    role: "CTO, Sample Co.",
    image: "professional headshot male executive"
  },
  {
    quote: "Best decision we made.",
    author: "Sam Reed",
    role: "VP Eng, Other Co.",
    image: "professional headshot female architect"
  }
];

function StringImageComponent() {
  return (
    <div>
      {TESTIMONIALS.map((t, i) => (
        <figure key={i}>
          <ExepadImage
            keywords={t.image}
            importance={6}
            width={100}
            height={100}
            className="w-12 h-12 rounded-sm object-cover"
          />
          <blockquote>{t.quote}</blockquote>
          <figcaption>{t.author} — {t.role}</figcaption>
        </figure>
      ))}
    </div>
  );
}

export default StringImageComponent;
