export function PageHeader(props: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">{props.title}</h1>
        {props.subtitle ? <p className="mt-0.5 text-sm text-gray-500">{props.subtitle}</p> : null}
      </div>
      {props.actions ? <div className="flex items-center gap-2">{props.actions}</div> : null}
    </div>
  );
}
