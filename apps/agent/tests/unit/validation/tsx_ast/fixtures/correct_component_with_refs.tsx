import { Button, LightDOMContainer, useApp, useModel, useHandler, navigate } from '@exepad/sdk';

export default function PostsList() {
  const filter = useApp(s => s.filter);
  const { data: posts } = useModel('posts');
  const { run } = useHandler('fetchPosts');

  const rows = (posts ?? []).map((post) => (
    <li key={post.id}>
      <Button aria-label={`Open ${post.title}`} onClick={() => navigate('/posts')}>
        {post.title}
      </Button>
    </li>
  ));

  return (
    <LightDOMContainer>
      <section className="bg-surface p-6">
        <h1 className="text-2xl">Posts ({filter ?? 'all'})</h1>
        <ul>{rows}</ul>
      </section>
    </LightDOMContainer>
  );
}
