export default function MainFooter() {
  const onScroll = (e) => { console.log(e.target.scrollTop); };
  return <div onScroll={onScroll}>foot</div>;
}
