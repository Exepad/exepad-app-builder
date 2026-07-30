import { React, useApp } from "@exepad/sdk";

export default function Profile() {
  const { profile, settings } = useApp((s) => ({
    profile: s.profile,
    settings: s.settings,
  }));
  return (
    <div>
      <span>{profile}</span>
      <span>{settings}</span>
    </div>
  );
}
