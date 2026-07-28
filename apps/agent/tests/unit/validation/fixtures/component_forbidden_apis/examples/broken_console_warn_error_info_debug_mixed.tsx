export default function NoisyComp() {
  console.warn("warn message");
  console.error("error message");
  console.info("info message");
  console.debug("debug message");
  return <div>noisy</div>;
}
