import { Navigate, Route, Routes } from "react-router-dom";
import { BoardRoute } from "./routes/BoardRoute";
import { DraftRoute } from "./routes/DraftRoute";
import { LoginRoute } from "./routes/LoginRoute";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<LoginRoute />} />
      <Route path="/draft/:draftId" element={<DraftRoute />} />
      <Route path="/board/:draftId" element={<BoardRoute />} />
    </Routes>
  );
}
