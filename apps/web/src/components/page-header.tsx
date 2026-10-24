import { getTranslations } from "@/lib/i18n/server";
export async function PageHeader(props: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  const tt = await getTranslations();
  return (
    <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">{tt(props.title)}</h1>
        {props.subtitle ? <p className="mt-0.5 text-sm text-gray-500">{tt(props.subtitle)}</p> : null}
      </div>
      {props.actions ? <div className="flex items-center gap-2">{props.actions}</div> : null}
    </div>
  );
}
