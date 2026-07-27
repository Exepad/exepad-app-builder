export default function HeroAvatar() {
  return (
    <div className="flex items-center gap-2">
      <ExepadImage
        keywords="founder portrait headshot warm light"
        importance={5}
        width={200}
        height={200}
        className="h-10 w-10 rounded-full"
      />
      <span>Account</span>
    </div>
  );
}
