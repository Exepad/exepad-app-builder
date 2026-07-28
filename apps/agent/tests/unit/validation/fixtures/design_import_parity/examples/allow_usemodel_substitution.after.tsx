<section><tbody>
{useModel('users').data?.map((u) => (
  <tr className="user-row"><td>{u.name ?? 'Maya Chen'}</td><td>{u.email ?? 'maya@onix.studio'}</td></tr>
))}
</tbody></section>
