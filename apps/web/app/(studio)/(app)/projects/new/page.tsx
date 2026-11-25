import { redirect } from "next/navigation";

// Songs are created from the studio create panel.
export default function NewProjectPage() {
  redirect("/create");
}
