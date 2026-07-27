import { React, useModel } from "@exepad/sdk";

function PlansList() {
  const { data: plans } = useModel("plans");
  return (
    <ul>
      {(plans ?? []).map((plan) => {
        const features = Array.isArray(plan.features)
          ? plan.features
          : JSON.parse(plan.features || "[]");
        return (
          <li key={plan.id}>
            {features.map((f: string) => (
              <span key={f}>{f}</span>
            ))}
          </li>
        );
      })}
    </ul>
  );
}

export default PlansList;
