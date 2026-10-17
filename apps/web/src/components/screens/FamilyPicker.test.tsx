import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "@/test/axe";
import { FamilyPickerScreen } from "./FamilyPickerScreen";

vi.mock("@/server/auth-actions", () => ({ chooseFamilyAction: vi.fn() }));

const families = [
  { id: "fam-a", name: "Família Souza" },
  { id: "fam-b", name: "Família Lima" },
];

describe("Qual família?", () => {
  it("lista só as famílias da pessoa e é acessível", async () => {
    const { container } = render(<FamilyPickerScreen families={families} onChoose={async () => ({ ok: true })} />);
    expect(screen.getByRole("heading", { name: "Qual família?" })).toBeInTheDocument();
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(expect.arrayContaining(["groupsFamília Souza", "groupsFamília Lima"]));
    expect(await axe(container)).toHaveNoViolations();
  });

  it("escolher manda o id da família e, se o servidor recusar, mostra o erro", async () => {
    const onChoose = vi.fn(async () => ({ ok: false }));
    render(<FamilyPickerScreen families={families} currentId="fam-a" onChoose={onChoose} />);
    expect(screen.getByRole("button", { name: /Família Souza \(atual\)/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Família Lima/ }));
    expect(onChoose).toHaveBeenCalledWith("fam-b");
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível abrir"));
  });
});
