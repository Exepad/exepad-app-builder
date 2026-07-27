export default function LoggedComp({ logger }) {
  logger.log("kept on purpose");
  logger.warn("also kept");
  return <div>logged</div>;
}
