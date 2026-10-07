import { Button } from "@/components/ui/Button";
import { signOutAction } from "@/app/(auth)/actions";

/** A form, not an onClick — sign-out is a mutation, so it works without JS. */
export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <Button type="submit" variant="ghost" size="sm">
        Log out
      </Button>
    </form>
  );
}
