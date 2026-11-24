// The game page's old address (alerts, links and history from builds before plugin screens): it
// opens the Sports plugin's game page, whose `event` param is the event's record key.
import { Redirect, useLocalSearchParams } from 'expo-router';

export function gamePageHref(id: string): `/screen/sports/game?event=${string}` {
  const key = id.startsWith('event:') ? id : `event:${id}`;
  return `/screen/sports/game?event=${encodeURIComponent(key)}`;
}

export default function Game() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  return <Redirect href={id ? gamePageHref(id) : '/'} />;
}
