import { React, useModel } from "@exepad/sdk";

function PlansList() {
  const { data: plans } = useModel("plans");
  return (
    <ul>
      {(plans ?? []).map((plan) => (
        <li key={plan.id}>{plan.name}</li>
      ))}
    </ul>
  );
}

export default PlansList;
