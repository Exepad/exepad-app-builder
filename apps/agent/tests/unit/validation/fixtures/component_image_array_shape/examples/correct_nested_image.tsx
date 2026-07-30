import { ExepadImage, LightDOMContainer, React } from '@exepad/sdk';

const teamMembers = [
  {
    name: "Alice",
    role: "CEO",
    image: { keywords: "professional portrait of female executive in modern office", importance: 7 },
  },
  {
    name: "Bob",
    role: "CTO",
    image: { keywords: "professional portrait of male engineer in tech workspace", importance: 7 },
  },
];

function Team() {
  return (
    <LightDOMContainer>
      <div className="grid grid-cols-2">
        {teamMembers.map((member) => (
          <ExepadImage key={member.name} {...member.image} width={200} height={200} />
        ))}
      </div>
    </LightDOMContainer>
  );
}

export default Team;
