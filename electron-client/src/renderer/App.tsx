import { useEffect, useState } from "react"
import MainWindow from "./components/MainWindow"
import Overlay from "./components/Overlay"

type Route = "control" | "overlay"

function getRouteFromHash(): Route {
  const h = window.location.hash || ""
  if (h.startsWith("#/overlay")) return "overlay"
  return "control" // default
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => getRouteFromHash())

  useEffect(() => {
    const onHashChange = () => setRoute(getRouteFromHash())
    window.addEventListener("hashchange", onHashChange)
    return () => window.removeEventListener("hashchange", onHashChange)
  }, [])

  const isOverlay = route === "overlay"

  return (
    <div
      className={
        isOverlay
          ? "w-screen h-screen bg-transparent"
          : "w-screen h-screen bg-white"
      }
    >
      {isOverlay ? <Overlay /> : <MainWindow />}
    </div>
  )
}