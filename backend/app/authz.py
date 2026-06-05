"""Authorization helpers for program (tenant/cohort) management.

The program hierarchy has exactly two levels:

* **Tenant** — ``parent_program_id IS NULL``. Represents a real-world unit
  (e.g. "MedLab Science") and may carry an ``oidc_group``. Tenant membership
  for any user is controlled only by admins and/or OIDC sync — never by
  instructors. This is the no-self-escalation invariant.
* **Cohort** — ``parent_program_id`` points at a tenant. Created by
  instructors to subdivide a tenant (e.g. by assessment timing) and always
  has ``oidc_group IS NULL``.

Authority follows tenant membership: an instructor co-manages every cohort
under a tenant they belong to, regardless of who created it. These helpers are
pure functions over already-loaded ORM objects so they are trivial to unit
test; the routers are responsible for loading the relevant rows.
"""

from .models import Program, User


def is_tenant(program: Program) -> bool:
    """A program is a tenant when it has no parent."""
    return program.parent_program_id is None


def is_cohort(program: Program) -> bool:
    """A program is a cohort when it has a parent (tenant)."""
    return program.parent_program_id is not None


def tenant_ids(user: User) -> set[int]:
    """Return the IDs of the tenant programs *user* belongs to.

    Only tenants (``parent_program_id IS NULL``) count toward an instructor's
    scope; cohort memberships do not widen authority.
    """
    return {p.id for p in user.programs if p.parent_program_id is None}


def can_create_cohort_under(user: User, parent: Program) -> bool:
    """Whether *user* may create a cohort whose parent tenant is *parent*.

    Admins may create a cohort under any tenant. Instructors may only create a
    cohort under a tenant they belong to, and never under another cohort
    (single-level hierarchy — no nesting).
    """
    if not is_tenant(parent):
        return False
    if user.role == "admin":
        return True
    if user.role != "instructor":
        return False
    return parent.id in tenant_ids(user)


def can_manage_program(user: User, program: Program) -> bool:
    """Whether *user* may rename/delete/assign within *program*.

    Admins manage every program (tenant or cohort). Instructors manage only
    cohorts whose parent tenant is in their scope — they can never manage a
    tenant. The name is deliberately program-wide because the admin branch
    short-circuits before the cohort check.
    """
    if user.role == "admin":
        return True
    if user.role != "instructor":
        return False
    if not is_cohort(program):
        return False
    return program.parent_program_id in tenant_ids(user)


def can_change_cohort_membership(
    user: User, cohort: Program, student: User,
) -> bool:
    """Whether *user* may add/remove *student* to/from *cohort*.

    The target must be a ``student`` and *user* must be able to manage the
    cohort. Instructors may additionally only touch students who already
    belong to the cohort's parent tenant (an instructor can never reach
    outside the tenants they were granted). Admins are not tenant-restricted.
    """
    if student.role != "student":
        return False
    if not is_cohort(cohort):
        return False
    if not can_manage_program(user, cohort):
        return False
    if user.role == "admin":
        return True
    return cohort.parent_program_id in tenant_ids(student)
