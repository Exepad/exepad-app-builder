import { React, useModel } from "@exepad/sdk";

// notes is type:"text" in the schema — JSON.parse is legitimate user code.
function NotesList() {
  const { data: posts } = useModel("posts");
  return (
    <ul>
      {(posts ?? []).map((post) => {
        const notes = Array.isArray(post.notes)
          ? post.notes
          : JSON.parse(post.notes || "[]");
        return <li key={post.id}>{notes.length} notes</li>;
      })}
    </ul>
  );
}

export default NotesList;
