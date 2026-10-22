import { RouterProvider } from "react-router";
import { ConsentBanner } from "@/features/consent/ConsentBanner";
import { router } from "@/routes/router";

export default function App() {
  return <><RouterProvider router={router} /><ConsentBanner /></>;
}
