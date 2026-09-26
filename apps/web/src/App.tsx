import { Route, Routes } from "react-router-dom";
import { BoardRoute } from "./routes/BoardRoute";
import { CommishRoute } from "./routes/CommishRoute";
import { DraftRoute } from "./routes/DraftRoute";
import { EditSettingsRoute } from "./routes/EditSettingsRoute";
import { HomeRoute } from "./routes/HomeRoute";
import { JoinRoute } from "./routes/JoinRoute";
import { LobbyRoute } from "./routes/LobbyRoute";
import { LoginRoute } from "./routes/LoginRoute";
import { NewLeagueRoute } from "./routes/NewLeagueRoute";
import { RostersRoute } from "./routes/RostersRoute";

// Page paths stay clear of the API prefixes the dev server proxies (/leagues, /invites, /drafts, /dev) — see vite.config.ts.
export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeRoute />} />
      <Route path="/login" element={<LoginRoute />} />
      <Route path="/league/new" element={<NewLeagueRoute />} />
      <Route path="/league/:leagueId" element={<LobbyRoute />} />
      <Route path="/league/:leagueId/settings" element={<EditSettingsRoute />} />
      <Route path="/join/:code" element={<JoinRoute />} />
      <Route path="/draft/:draftId" element={<DraftRoute />} />
      <Route path="/draft/:draftId/commish" element={<CommishRoute />} />
      <Route path="/draft/:draftId/rosters" element={<RostersRoute />} />
      <Route path="/board/:draftId" element={<BoardRoute />} />
    </Routes>
  );
}
