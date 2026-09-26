import { CommissionerConsole } from "../components/commish/CommissionerConsole";
import { useDraft } from "../store/DraftProvider";
import { DraftSubpage } from "./DraftSubpage";

function CommishGate() {
  const { snapshot } = useDraft();
  if (snapshot && !snapshot.isCommissioner) {
    return <div className="flex flex-grow items-center justify-center text-center text-muted">Only the league commissioner can open this console.</div>;
  }
  return <CommissionerConsole />;
}

export function CommishRoute() {
  return (
    <DraftSubpage>
      <CommishGate />
    </DraftSubpage>
  );
}
