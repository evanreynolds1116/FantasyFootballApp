import { DEFAULT_SETTINGS } from "@draft-app/engine";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { SettingsForm } from "../components/setup/SettingsForm";
import { api, serverErrorList } from "../lib/api";
import { useAuth } from "../lib/auth";
import { AppPage, RequireSession } from "./AppPage";

function NewLeague() {
  const token = useAuth().session!.token;
  const navigate = useNavigate();
  const [serverErrors, setServerErrors] = useState<string[]>([]);

  return (
    <AppPage wide>
      <h1 className="font-display text-[26px] font-extrabold uppercase">New league</h1>
      <p className="text-muted">Your league&apos;s usual rules are filled in. Change anything you need, then invite everyone from the lobby.</p>
      <SettingsForm
        initialName=""
        initialSettings={DEFAULT_SETTINGS}
        submitLabel="Create league"
        serverErrors={serverErrors}
        onSubmit={async (name, settings) => {
          setServerErrors([]);
          try {
            const { leagueId } = await api<{ leagueId: string }>(token, "POST", "/leagues", { name, settings });
            navigate(`/league/${leagueId}`);
          } catch (err) {
            setServerErrors(serverErrorList(err, "Could not create the league."));
          }
        }}
      />
    </AppPage>
  );
}

export function NewLeagueRoute() {
  return (
    <RequireSession>
      <NewLeague />
    </RequireSession>
  );
}
