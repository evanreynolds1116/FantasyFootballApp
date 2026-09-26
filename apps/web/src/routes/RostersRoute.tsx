import { RostersScreen } from "../components/rosters/RostersScreen";
import { DraftSubpage } from "./DraftSubpage";

export function RostersRoute() {
  return (
    <DraftSubpage>
      <RostersScreen />
    </DraftSubpage>
  );
}
